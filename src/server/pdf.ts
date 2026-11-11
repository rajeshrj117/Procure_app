function ascii(value: string) {
  return value.replace(/[^\x09\x20-\x7E]/g, " ");
}

function escapePdf(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(value: string, width: number) {
  if (!value) return [""];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function buildPdf(title: string, lines: string[]) {
  const prepared = [title, ""].concat(lines).flatMap((line) => wrap(ascii(line), 92));
  const chunks: string[][] = [];
  for (let i = 0; i < prepared.length; i += 46) chunks.push(prepared.slice(i, i + 46));
  if (!chunks.length) chunks.push([""]);

  const objects = new Map<number, string>();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageIds: number[] = [];
  let nextId = 4;
  for (const chunk of chunks) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageIds.push(pageId);
    const commands = ["BT", "/F1 10 Tf", "14 TL", "48 800 Td"];
    chunk.forEach((line, idx) => {
      commands.push(idx === 0 ? `(${escapePdf(line)}) Tj` : `(${escapePdf(line)}) '`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
  }
  objects.set(2, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);

  const maxId = Math.max(...objects.keys());
  let pdf = "%PDF-1.4\n";
  const offsets = new Array<number>(maxId + 1).fill(0);
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects.get(id) ?? "<< >>"}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${maxId + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id <= maxId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
