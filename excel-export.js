'use strict';

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOCUMENT_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeCellText = (value) => value.replace(/[&<>]/g, (character) => XML_ENTITIES[character]);

function travelSheet({ tripLabel, period, duration, rows, amount, note }) {
  const columns = ['A', 'B', 'C'];
  const textCell = (reference, value, style) =>
    `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeCellText(value)}</t></is></c>`;
  const row = (index, height, cells) =>
    `<row r="${index}" ht="${height}" customHeight="1">${cells.join('')}</row>`;
  const textRow = (index, height, values, style) =>
    row(index, height, values.map((value, column) => textCell(`${columns[column]}${index}`, value, style)));

  const firstItem = 7;
  const totalRow = firstItem + rows.length;
  const mergeRanges = ['A1:C1', 'B2:C2', 'B3:C3', 'B4:C4'];
  const sheetRows = [
    textRow(1, 30, ['출장여비 계산 내역'], 1),
    textRow(2, 22, ['출장 구분', tripLabel], 0),
    textRow(3, 22, ['출장 기간', period], 0),
    textRow(4, 22, ['소요 기간', duration], 0),
    textRow(6, 24, ['항목', '지급액 (원)', '계산 근거'], 2),
  ];

  rows.forEach(({ label, amount, basis }, offset) => {
    const index = firstItem + offset;
    const height = Math.min(400, 20 + 16 * Math.floor(basis.length / 32));
    sheetRows.push(row(index, height, [
      textCell(`A${index}`, label, 0),
      `<c r="B${index}" s="3"><v>${amount}</v></c>`,
      textCell(`C${index}`, basis, 0),
    ]));
  });
  sheetRows.push(row(totalRow, 24, [
    textCell(`A${totalRow}`, '예상 지급 총액', 2),
    `<c r="B${totalRow}" s="4"><f>SUM(B${firstItem}:B${totalRow - 1})</f><v>${amount}</v></c>`,
  ]));
  if (note) {
    const noteRow = totalRow + 2;
    sheetRows.push(textRow(noteRow, 30, ['비고', note], 0));
    mergeRanges.push(`B${noteRow}:C${noteRow}`);
  }

  return `<worksheet xmlns="${SHEET_NS}">
    <cols>
      <col min="1" max="1" width="25" customWidth="1"/>
      <col min="2" max="2" width="22" customWidth="1"/>
      <col min="3" max="3" width="65" customWidth="1"/>
    </cols>
    <sheetData>${sheetRows.join('')}</sheetData>
    <mergeCells count="${mergeRanges.length}">${mergeRanges.map((range) => `<mergeCell ref="${range}"/>`).join('')}</mergeCells>
  </worksheet>`;
}

const TRAVEL_SHEET_STYLES = `<styleSheet xmlns="${SHEET_NS}">
  <fonts count="3">
    <font><sz val="11"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="16"/><color rgb="FF17294B"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF3448B0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="3" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

async function saveTravelWorkbook(result) {
  // An Excel workbook is a ZIP package containing SpreadsheetML and its relationships.
  const zip = new JSZip();
  const parts = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>`,
    '_rels/.rels': `<Relationships xmlns="${PACKAGE_REL_NS}">
      <Relationship Id="rId1" Type="${DOCUMENT_REL_NS}/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${SHEET_NS}" xmlns:r="${DOCUMENT_REL_NS}">
      <sheets><sheet name="출장여비" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PACKAGE_REL_NS}">
      <Relationship Id="rId1" Type="${DOCUMENT_REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="${DOCUMENT_REL_NS}/styles" Target="styles.xml"/>
    </Relationships>`,
    'xl/worksheets/sheet1.xml': travelSheet(result),
    'xl/styles.xml': TRAVEL_SHEET_STYLES,
  };
  for (const [path, xml] of Object.entries(parts)) zip.file(path, XML_HEADER + xml);

  const file = await zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `출장여비_${result.date}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
