// Compiles the captured per-query artifacts (.local/e2e-report/*.json + *.png) into a single .docx
// test report: one section per query with (1) the agent trace, (2) the spec document, and (3) the
// completed simulation image. Run after the capture pass:
//   RUN_LIVE_E2E=1 npx playwright test tests/e2e/report-capture.spec.js --project=desktop-chromium
//   node scripts/buildE2eReport.mjs
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType } from 'docx';

const IN_DIR = path.resolve('.local/e2e-report');
const OUT_DIR = path.resolve('docs/reports');
const OUT_FILE = path.join(OUT_DIR, 'H-eduware-e2e-report.docx');

function heading(text, level) {
  return new Paragraph({ heading: level, children: [new TextRun({ text })] });
}
function body(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })] });
}
function bullet(text) {
  return new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text })] });
}

function specSection(data) {
  const out = [heading('2. Spec document (simulation spec)', HeadingLevel.HEADING_2)];
  const spec = data.circuitSpec;
  if (spec) {
    out.push(body(`Title: ${spec.title ?? ''}`, { bold: true }));
    out.push(body(`Goal: ${spec.intent?.primaryGoal ?? ''}`));
    out.push(body('Components:', { bold: true }));
    for (const c of spec.components ?? []) out.push(bullet(`${c.partId}${c.label ? ` — ${c.label}` : ''}`));
    out.push(body(`Connections: ${(spec.connections ?? []).length}`));
    out.push(body(`Build runnable: ${data.buildRunnableReport?.runnable ? 'yes' : 'no'} (${data.buildRunnableReport?.status ?? 'n/a'})`));
  }
  if (data.requirementMarkdown) {
    out.push(body('Requirement document:', { bold: true }));
    for (const line of data.requirementMarkdown.split('\n').slice(0, 60)) out.push(body(line));
  }
  if (!spec && !data.requirementMarkdown) out.push(body('(no spec — conversational/clarification turn)', { italics: true }));
  return out;
}

function traceSection(data) {
  const out = [heading('1. Agent trace', HeadingLevel.HEADING_2)];
  out.push(body(`Response kind: ${data.responseKind ?? 'n/a'}`));
  if (data.assistantMessages?.length) out.push(body(`Assistant: ${data.assistantMessages.join(' / ').slice(0, 400)}`));
  out.push(body('Events:', { bold: true }));
  for (const e of data.agentEvents ?? []) {
    out.push(bullet(`[${e.type}] ${e.name} — ${e.status}${e.summary ? `: ${e.summary}` : ''}`));
  }
  out.push(body('Context trace (sources):', { bold: true }));
  for (const t of (data.contextTrace ?? []).slice(0, 30)) out.push(bullet(`${t.sourceId ?? t.title ?? ''}`));
  return out;
}

function imageSection(id) {
  const png = path.join(IN_DIR, `${id}.png`);
  const out = [heading('3. Completed simulation', HeadingLevel.HEADING_2)];
  if (existsSync(png)) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ data: readFileSync(png), transformation: { width: 560, height: 360 } })]
    }));
  } else {
    out.push(body('(no simulation image — this turn did not build a runnable circuit)', { italics: true }));
  }
  return out;
}

function main() {
  if (!existsSync(IN_DIR)) {
    console.error(`No captures at ${IN_DIR}. Run the capture spec first.`);
    process.exit(1);
  }
  const ids = readdirSync(IN_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  if (ids.length === 0) {
    console.error('No captured query results found.');
    process.exit(1);
  }

  const children = [
    heading('H-eduware — End-to-End Simulation Test Report', HeadingLevel.TITLE),
    body(`${ids.length} student queries, captured live through the local app (agent + simulation).`),
    body('Each section: (1) agent trace, (2) spec document, (3) completed simulation image.')
  ];

  for (const id of ids) {
    const data = JSON.parse(readFileSync(path.join(IN_DIR, `${id}.json`), 'utf8'));
    children.push(heading(`Query: "${data.prompt}"  (${id})`, HeadingLevel.HEADING_1));
    children.push(...traceSection(data), ...specSection(data), ...imageSection(id));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  Packer.toBuffer(new Document({ sections: [{ children }] })).then((buf) => {
    writeFileSync(OUT_FILE, buf);
    console.log(`Wrote ${OUT_FILE} (${ids.length} queries, ${(buf.length / 1024).toFixed(0)} KB).`);
  });
}

main();
