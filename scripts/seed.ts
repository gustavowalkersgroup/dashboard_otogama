/**
 * Popula o banco com dados fake realistas (últimos 45 dias) para desenvolver
 * e demonstrar sem produção. Idempotente: reexecutar no mesmo dia não duplica
 * (dedup pelo índice único + PRNG com semente fixa).
 *
 * Uso: npm run seed   (lê .env.local se existir)
 */
import { neon, neonConfig } from "@neondatabase/serverless";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sem .env.local — usa o ambiente do shell
}

if (process.env.NEON_HTTP_PROXY) {
  neonConfig.fetchEndpoint = process.env.NEON_HTTP_PROXY;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não configurada (defina em .env.local ou no ambiente).");
  process.exit(1);
}
const sql = neon(url);
const TENANT = process.env.TENANT_ID ?? "otogama";

// PRNG com semente fixa — mesma sequência a cada execução
let semente = 42;
function rnd(): number {
  semente = (semente * 1664525 + 1013904223) % 4294967296;
  return semente / 4294967296;
}
const entre = (min: number, max: number) => min + rnd() * (max - min);
const inteiro = (min: number, max: number) => Math.floor(entre(min, max + 1));
const escolha = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

/** Desfecho terminal de uma consulta, dadas as chances de Realizado/Faltou (resto = Cancelado). */
function situacaoTerminal(pRealizado: number, pFaltou: number): "Realizado" | "Faltou" | "Cancelado" {
  const r = rnd();
  if (r < pRealizado) return "Realizado";
  if (r < pRealizado + pFaltou) return "Faltou";
  return "Cancelado";
}

const NOMES = [
  "Maria Silva", "José Santos", "Ana Oliveira", "João Souza", "Francisca Lima",
  "Antônio Pereira", "Adriana Costa", "Carlos Rodrigues", "Juliana Almeida",
  "Paulo Nascimento", "Fernanda Araújo", "Marcos Ribeiro", "Patrícia Carvalho",
  "Lucas Gomes", "Camila Martins", "Rafael Rocha", "Aline Barbosa", "Bruno Dias",
  "Larissa Moreira", "Tiago Cardoso", "Vanessa Teixeira", "Eduardo Correia",
  "Simone Mendes", "Gustavo Freitas", "Beatriz Cavalcanti", "Rodrigo Pinto",
  "Letícia Moura", "Felipe Ramos", "Débora Azevedo", "Sérgio Barros",
];

const MEDICOS = ["Dr. Ricardo Prado", "Dra. Helena Vasconcelos", "Dr. Marcelo Fontes"];
const SERVICOS = ["Consulta Otorrino", "Audiometria", "Videolaringoscopia", "Nasofibroscopia"];
const CAUSAS_QUEDA = [
  "HTTP 502 — processo da API parado",
  "HTTP 530 — túnel Cloudflare fora do ar",
];

function telefoneFake(): string {
  return `55619${inteiro(6000, 9999)}${inteiro(1000, 9999)}`;
}

// dia BRT `off` dias atrás, às hh:mm locais (BRT = UTC-3 fixo)
function brt(off: number, hora: number, minuto: number): Date {
  const hojeBRT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
  const d = new Date(`${hojeBRT}T00:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() - off);
  d.setUTCMinutes(d.getUTCMinutes() + (hora + 3) * 60 + minuto); // volta pra UTC
  return d;
}

type Evento = {
  tipo: string;
  chave: string | null;
  telefone: string | null;
  paciente: string | null;
  payload: Record<string, unknown>;
  ts: Date;
};

const eventos: Evento[] = [];
let proximaChave = 561000;
const DIAS = 45;
const agora = new Date();

for (let off = DIAS; off >= 0; off--) {
  const diaSemana = brt(off, 12, 0).getUTCDay(); // 0=dom … 6=sáb (aprox., meio-dia BRT)
  if (diaSemana === 0) continue; // clínica fechada no domingo

  // ---- coortes de lembrete: agendamentos do dia, avisados na véspera (d1) e no dia (d0)
  const qtd = diaSemana === 6 ? inteiro(3, 6) : inteiro(6, 13);
  for (let i = 0; i < qtd; i++) {
    const paciente = escolha(NOMES);
    const telefone = telefoneFake();
    const nChaves = rnd() < 0.15 ? 2 : 1; // ~15% das mensagens agrupam 2 agendamentos
    const chaves = Array.from({ length: nChaves }, () => String(proximaChave++));
    const medico = escolha(MEDICOS);
    const horaConsulta = `${String(inteiro(8, 17)).padStart(2, "0")}:${escolha(["00", "20", "40"])}`;
    const dataConsulta = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
    }).format(brt(off, 12, 0));
    const payloadBase = {
      tipo_consulta: escolha(["consulta", "consulta", "consulta", "exame"]),
      medico,
      especialidade: "Otorrinolaringologia",
      data_consulta: dataConsulta,
      hora: horaConsulta,
    };
    const servicoConsulta =
      payloadBase.tipo_consulta === "exame" ? escolha(SERVICOS.slice(1)) : SERVICOS[0];
    const situacaoPayload = (situacao: string) => ({
      situacao,
      medico,
      especialidade: "Otorrinolaringologia",
      servico: servicoConsulta,
      data_consulta: dataConsulta,
      hora_consulta: horaConsulta,
    });
    const [horaC, minutoC] = horaConsulta.split(":").map(Number);
    const tsConsulta = brt(off, horaC, minutoC);

    const tsD1 = brt(off + 1, 18, inteiro(0, 45));
    const tsD0 = brt(off, 7, inteiro(20, 55));
    for (const [origem, ts] of [["d1", tsD1], ["d0", tsD0]] as const) {
      if (ts > agora) continue;
      for (const chave of chaves) {
        eventos.push({
          tipo: "envio_lembrete",
          chave,
          telefone,
          paciente,
          payload: { origem, ...payloadBase },
          ts,
        });
      }
    }
    // poll horário na Konsist vê a consulta como "Agendado" desde o lembrete da véspera
    if (tsD1 <= agora) {
      for (const chave of chaves) {
        eventos.push({
          tipo: "status_consulta",
          chave,
          telefone,
          paciente,
          payload: situacaoPayload("Agendado"),
          ts: tsD1,
        });
      }
    }

    // ~72% confirmam; a maioria algumas horas depois do lembrete da véspera
    const sorte = rnd();
    if (sorte < 0.72) {
      const deltaMin = rnd() < 0.5 ? entre(4, 90) : entre(90, 16 * 60);
      const tsConf = new Date(tsD1.getTime() + deltaMin * 60_000);
      if (tsConf <= agora) {
        const resultado = rnd() < 0.07 ? "ja_confirmado" : "ok";
        for (const chave of chaves) {
          eventos.push({
            tipo: "confirmacao",
            chave,
            telefone,
            paciente,
            payload: { resultado },
            ts: tsConf,
          });
        }
        // a Konsist reflete a confirmação pouco depois, no poll seguinte
        const tsConfirmado = new Date(tsConf.getTime() + entre(5, 30) * 60_000);
        if (tsConfirmado <= agora) {
          for (const chave of chaves) {
            eventos.push({
              tipo: "status_consulta",
              chave,
              telefone,
              paciente,
              payload: situacaoPayload("Confirmado"),
              ts: tsConfirmado,
            });
          }
        }
      }
    } else if (sorte < 0.76) {
      // clicou "preciso de ajuda" em vez de confirmar
      const tsAjuda = new Date(tsD1.getTime() + entre(10, 300) * 60_000);
      if (tsAjuda <= agora) {
        eventos.push({
          tipo: "precisa_ajuda",
          chave: chaves[0],
          telefone,
          paciente,
          payload: { origem: "fluxo_confirmacao" },
          ts: tsAjuda,
        });
      }
    } else if (sorte < 0.78) {
      // confirmou mas a Konsist não achou o paciente (falha de write-back)
      const tsConf = new Date(tsD1.getTime() + entre(30, 600) * 60_000);
      if (tsConf <= agora) {
        eventos.push({
          tipo: "confirmacao",
          chave: chaves[0],
          telefone,
          paciente,
          payload: { resultado: "sem_paciente" },
          ts: tsConf,
        });
      }
    }
    // o restante simplesmente não responde (aparece em "sem resposta")

    // ---- desfecho real da consulta (poll horário na Konsist), só depois do horário marcado
    if (tsConsulta <= agora) {
      const situacao =
        sorte < 0.72
          ? situacaoTerminal(0.9, 0.07) // confirmou
          : sorte < 0.76
            ? situacaoTerminal(0.45, 0.45) // pediu ajuda em vez de confirmar
            : sorte < 0.78
              ? situacaoTerminal(0.7, 0.2) // confirmou mas sem_paciente na Konsist
              : situacaoTerminal(0.3, 0.6); // nunca respondeu — é aqui que o no-show pesa mais
      const tsTerminal =
        situacao === "Cancelado"
          ? new Date(tsConsulta.getTime() - entre(2, 72) * 3_600_000)
          : new Date(tsConsulta.getTime() + entre(10, 90) * 60_000);
      if (tsTerminal <= agora) {
        for (const chave of chaves) {
          eventos.push({
            tipo: "status_consulta",
            chave,
            telefone,
            paciente,
            payload: situacaoPayload(situacao),
            ts: tsTerminal,
          });
        }
      }
    }
  }

  // ---- agendamentos criados pela IA (origem=1, Em Análise → Agendado/Recusado)
  if (diaSemana >= 1 && diaSemana <= 5) {
    const qtdIa = inteiro(1, 4);
    for (let i = 0; i < qtdIa; i++) {
      const paciente = escolha(NOMES);
      const telefone = telefoneFake();
      const chave = String(proximaChave++);
      const protocolo = `P${inteiro(100000, 999999)}`;
      const medicoIa = escolha(MEDICOS);
      const servicoIa = escolha(SERVICOS);
      const tsIa = brt(off, inteiro(8, 19), inteiro(0, 59));
      if (tsIa > agora) continue;
      eventos.push({
        tipo: "agendamento_ia",
        chave,
        telefone,
        paciente,
        payload: {
          protocolo,
          medico: medicoIa,
          especialidade: "Otorrinolaringologia",
          servico: servicoIa,
          idstatus: 1,
          status: "Em Análise",
        },
        ts: tsIa,
      });
      if (rnd() < 0.75) {
        const recusado = rnd() < 0.18;
        const tsDesfecho = new Date(tsIa.getTime() + entre(2, 36) * 3_600_000);
        if (tsDesfecho <= agora) {
          eventos.push({
            tipo: "desfecho_agendamento",
            chave,
            telefone,
            paciente,
            payload: {
              protocolo,
              idstatus: recusado ? 3 : 2,
              status: recusado ? "Recusado" : "Agendado",
            },
            ts: tsDesfecho,
          });

          // aprovado pela recepção: a consulta em si acontece alguns dias depois
          if (!recusado) {
            const tsConsultaIa = new Date(tsDesfecho.getTime() + entre(1, 5) * 24 * 3_600_000);
            const dataConsultaIa = new Intl.DateTimeFormat("pt-BR", {
              timeZone: "America/Sao_Paulo",
            }).format(tsConsultaIa);
            const horaConsultaIa = new Intl.DateTimeFormat("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            }).format(tsConsultaIa);
            const situacaoPayloadIa = (situacao: string) => ({
              situacao,
              medico: medicoIa,
              especialidade: "Otorrinolaringologia",
              servico: servicoIa,
              data_consulta: dataConsultaIa,
              hora_consulta: horaConsultaIa,
            });
            eventos.push({
              tipo: "status_consulta",
              chave,
              telefone,
              paciente,
              payload: situacaoPayloadIa("Agendado"),
              ts: tsDesfecho,
            });
            if (tsConsultaIa <= agora) {
              const situacao = situacaoTerminal(0.85, 0.1);
              const tsTerminalIa =
                situacao === "Cancelado"
                  ? new Date(tsConsultaIa.getTime() - entre(2, 48) * 3_600_000)
                  : new Date(tsConsultaIa.getTime() + entre(10, 90) * 60_000);
              if (tsTerminalIa <= agora) {
                eventos.push({
                  tipo: "status_consulta",
                  chave,
                  telefone,
                  paciente,
                  payload: situacaoPayloadIa(situacao),
                  ts: tsTerminalIa,
                });
              }
            }
          }
        }
      }
    }
  }

  // ---- quedas da API Konsist (~2 por semana)
  if (rnd() < 0.3) {
    const tsFora = brt(off, inteiro(0, 22), inteiro(0, 59));
    const duracaoMin = Math.round(entre(8, 210));
    const tsOk = new Date(tsFora.getTime() + duracaoMin * 60_000);
    const causa = escolha(CAUSAS_QUEDA);
    if (tsFora <= agora) {
      eventos.push({
        tipo: "api_status",
        chave: null,
        telefone: null,
        paciente: null,
        payload: { estado: "fora", detalhe: causa },
        ts: tsFora,
      });
      if (tsOk <= agora) {
        eventos.push({
          tipo: "api_status",
          chave: null,
          telefone: null,
          paciente: null,
          payload: { estado: "ok", detalhe: causa, duracao_min: duracaoMin },
          ts: tsOk,
        });
      }
    }
  }
}

async function main() {
  console.log(`Inserindo ${eventos.length} eventos…`);
  let inseridos = 0;
  for (const [i, e] of eventos.entries()) {
    const linhas = await sql.query(
      `INSERT INTO eventos (tenant_id, tipo, chave, telefone, paciente, payload, ts)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (tenant_id, tipo, COALESCE(chave, ''), ts) DO NOTHING
       RETURNING id`,
      [TENANT, e.tipo, e.chave, e.telefone, e.paciente, JSON.stringify(e.payload), e.ts.toISOString()],
    );
    if ((linhas as unknown[]).length > 0) inseridos++;
    if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${eventos.length}…`);
  }
  console.log(`Pronto: ${inseridos} inseridos, ${eventos.length - inseridos} já existiam (dedup).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
