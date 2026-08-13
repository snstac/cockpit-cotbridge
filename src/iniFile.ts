/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * Comment- and order-preserving INI document model, compatible with the
 * subset of Python ConfigParser that cotbridge uses: '[section]' headers,
 * 'key = value' / 'key: value' entries (option names case-insensitive),
 * '#'/';' full-line comments, and indented continuation lines.
 *
 * Unmodified entries and comments round-trip byte-for-byte; edited or added
 * entries are written as 'Key = value'.
 */

export type IniEntry = {
    kind: 'entry';
    /** Lower-cased option name (ConfigParser semantics). */
    key: string;
    /** Option name as it appears in the file. */
    rawKey: string;
    value: string;
    /** Original file lines (including continuations); replayed when not dirty. */
    rawLines: string[];
    dirty: boolean;
};

export type IniRaw = { kind: 'raw'; text: string };

export type IniLine = IniEntry | IniRaw;

export type IniSection = {
    name: string;
    /** Original '[...]' header line, replayed verbatim. */
    rawHeader: string;
    lines: IniLine[];
};

export type IniDoc = {
    preamble: IniLine[];
    sections: IniSection[];
};

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
const ENTRY_RE = /^([^\s=:][^=:]*?)\s*[=:]\s*(.*)$/;

function isComment(line: string): boolean {
    const t = line.trimStart();
    return t.startsWith('#') || t.startsWith(';');
}

export function parseIni(content: string): IniDoc {
    const doc: IniDoc = { preamble: [], sections: [] };
    let lines: IniLine[] = doc.preamble;
    let lastEntry: IniEntry | null = null;

    for (const line of content.split('\n')) {
        const sect = line.match(SECTION_RE);
        if (sect && !isComment(line)) {
            const section: IniSection = { name: sect[1], rawHeader: line, lines: [] };
            doc.sections.push(section);
            lines = section.lines;
            lastEntry = null;
            continue;
        }
        if (!line.trim() || isComment(line)) {
            lines.push({ kind: 'raw', text: line });
            // A blank line ends a multi-line value, a comment does not (ConfigParser
            // skips comment lines inside continuations). Keep it simple: both end it.
            lastEntry = null;
            continue;
        }
        // Continuation: indented non-blank line following an entry.
        if (/^\s/.test(line) && lastEntry) {
            lastEntry.value += '\n' + line.trim();
            lastEntry.rawLines.push(line);
            continue;
        }
        const m = line.match(ENTRY_RE);
        if (m) {
            const entry: IniEntry = {
                kind: 'entry',
                key: m[1].trim().toLowerCase(),
                rawKey: m[1].trim(),
                value: m[2].trim(),
                rawLines: [line],
                dirty: false,
            };
            lines.push(entry);
            lastEntry = entry;
        } else {
            lines.push({ kind: 'raw', text: line });
            lastEntry = null;
        }
    }
    return doc;
}

function serializeEntry(entry: IniEntry): string[] {
    if (!entry.dirty)
        return entry.rawLines;
    const parts = entry.value.split('\n');
    const first = `${entry.rawKey} = ${parts[0]}`;
    return [first, ...parts.slice(1).map(p => `    ${p}`)];
}

export function serializeIni(doc: IniDoc): string {
    const out: string[] = [];
    for (const line of doc.preamble)
        out.push(...(line.kind === 'raw' ? [line.text] : serializeEntry(line)));
    for (const section of doc.sections) {
        out.push(section.rawHeader);
        for (const line of section.lines)
            out.push(...(line.kind === 'raw' ? [line.text] : serializeEntry(line)));
    }
    let text = out.join('\n');
    if (!text.endsWith('\n'))
        text += '\n';
    return text;
}

export function findSection(doc: IniDoc, name: string): IniSection | undefined {
    return doc.sections.find(s => s.name === name);
}

/** Case-insensitive lookup, for guarding against ConfigParser near-duplicates. */
export function findSectionFold(doc: IniDoc, name: string): IniSection | undefined {
    const lowered = name.toLowerCase();
    return doc.sections.find(s => s.name.toLowerCase() === lowered);
}

export function addSection(doc: IniDoc, name: string): IniSection {
    const section: IniSection = { name, rawHeader: `[${name}]`, lines: [] };
    // Separate from the previous block with a blank line.
    const prev = doc.sections[doc.sections.length - 1];
    const prevLines = prev ? prev.lines : doc.preamble;
    const last = prevLines[prevLines.length - 1];
    if (last && !(last.kind === 'raw' && last.text.trim() === ''))
        prevLines.push({ kind: 'raw', text: '' });
    doc.sections.push(section);
    return section;
}

export function removeSection(doc: IniDoc, name: string): boolean {
    const idx = doc.sections.findIndex(s => s.name === name);
    if (idx < 0)
        return false;
    doc.sections.splice(idx, 1);
    return true;
}

export function getValue(section: IniSection, key: string): string | undefined {
    const lowered = key.toLowerCase();
    // ConfigParser keeps the last duplicate; scan from the end.
    for (let i = section.lines.length - 1; i >= 0; i--) {
        const line = section.lines[i];
        if (line.kind === 'entry' && line.key === lowered)
            return line.value;
    }
    return undefined;
}

export function setValue(section: IniSection, key: string, value: string): void {
    const lowered = key.toLowerCase();
    let target: IniEntry | undefined;
    for (const line of section.lines) {
        if (line.kind === 'entry' && line.key === lowered)
            target = line; // last one wins, matching getValue
    }
    if (target) {
        if (target.value !== value) {
            target.value = value;
            target.dirty = true;
        }
        return;
    }
    const entry: IniEntry = {
        kind: 'entry',
        key: lowered,
        rawKey: key,
        value,
        rawLines: [],
        dirty: true,
    };
    // Insert after the last entry so trailing comments/blank lines stay at the end.
    let insertAt = 0;
    section.lines.forEach((line, i) => {
        if (line.kind === 'entry')
            insertAt = i + 1;
    });
    section.lines.splice(insertAt, 0, entry);
}

export function deleteKey(section: IniSection, key: string): boolean {
    const lowered = key.toLowerCase();
    const before = section.lines.length;
    section.lines = section.lines.filter(l => !(l.kind === 'entry' && l.key === lowered));
    return section.lines.length !== before;
}

export function sectionValues(section: IniSection): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of section.lines) {
        if (line.kind === 'entry')
            out[line.key] = line.value;
    }
    return out;
}
