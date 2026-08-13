/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * Lane domain model on top of the INI document: list, edit, add, and remove
 * '[lane:*]' sections in /etc/cotbridge.ini without disturbing anything else.
 */

import {
    type IniDoc,
    type IniSection,
    addSection,
    findSectionFold,
    getValue,
    deleteKey,
    removeSection,
    sectionValues,
    setValue,
} from './iniFile';
import { truthy } from './cotUrl';

export const LANE_PREFIX = 'lane:';
export const GLOBAL_SECTION = 'cotbridge';

/** Keys the structured editor owns; everything else is preserved untouched. */
export const LANE_EDITOR_KEYS = [
    'enabled',
    'mode',
    'ingress_cot_url',
    'egress_cot_url',
    'pytak_no_hello',
    'tak_proto',
    'pytak_tls_client_cert',
    'pytak_tls_client_key',
    'pytak_tls_client_cafile',
    'pytak_tls_client_password',
    'pytak_tls_dont_verify',
    'pytak_tls_dont_check_hostname',
] as const;

export type LaneEditorKey = typeof LANE_EDITOR_KEYS[number];

export type Lane = {
    /** Display name, as the daemon derives it (lowered, after the prefix). */
    name: string;
    /** Exact section name in the file, e.g. 'lane:local-to-mesh'. */
    sectionName: string;
    enabled: boolean;
    mode: string;
    values: Partial<Record<LaneEditorKey, string>>;
    /** Keys present in the section that the editor does not manage. */
    extraKeys: string[];
};

export function isLaneSection(name: string): boolean {
    return name.toLowerCase().startsWith(LANE_PREFIX);
}

export function laneDisplayName(sectionName: string): string {
    const lowered = sectionName.toLowerCase();
    const rest = lowered
            .split(':')
            .slice(1)
            .join(':')
            .trim();
    return rest || lowered;
}

function laneFromSection(section: IniSection): Lane {
    const all = sectionValues(section);
    const values: Partial<Record<LaneEditorKey, string>> = {};
    const extraKeys: string[] = [];
    for (const key of Object.keys(all)) {
        if ((LANE_EDITOR_KEYS as readonly string[]).includes(key))
            values[key as LaneEditorKey] = all[key];
        else
            extraKeys.push(key);
    }
    return {
        name: laneDisplayName(section.name),
        sectionName: section.name,
        enabled: truthy(all.enabled),
        mode: (all.mode || 'forward').trim().toLowerCase(),
        values,
        extraKeys,
    };
}

export function listLanes(doc: IniDoc): Lane[] {
    return doc.sections.filter(s => isLaneSection(s.name)).map(laneFromSection);
}

export const LANE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function validateLaneName(doc: IniDoc, name: string): string | null {
    if (!LANE_NAME_RE.test(name))
        return 'Lane name must be lowercase letters, digits, dots, dashes or underscores.';
    if (findSectionFold(doc, LANE_PREFIX + name))
        return `A lane named '${name}' already exists.`;
    return null;
}

export function addLane(doc: IniDoc, name: string): IniSection {
    return addSection(doc, LANE_PREFIX + name);
}

export function removeLane(doc: IniDoc, sectionName: string): boolean {
    return removeSection(doc, sectionName);
}

/**
 * Apply editor values to a lane section. Keys with empty values are removed
 * (so lanes fall back to '[cotbridge]' globals), except 'enabled' and 'mode'
 * which are always written explicitly.
 */
export function applyLaneValues(
    section: IniSection,
    values: Partial<Record<LaneEditorKey, string>>
): void {
    for (const key of LANE_EDITOR_KEYS) {
        const value = (values[key] ?? '').trim();
        if (key === 'enabled' || key === 'mode') {
            setValue(section, key, value || (key === 'mode' ? 'forward' : 'false'));
        } else if (value === '') {
            deleteKey(section, key);
        } else {
            setValue(section, key, value);
        }
    }
}

export function ensureGlobalSection(doc: IniDoc): IniSection {
    return findSectionFold(doc, GLOBAL_SECTION) ?? addSection(doc, GLOBAL_SECTION);
}

/** Effective value for a lane key after global-section inheritance. */
export function effectiveLaneValue(doc: IniDoc, lane: Lane, key: LaneEditorKey): string | undefined {
    const own = lane.values[key];
    if (own !== undefined)
        return own;
    const globals = findSectionFold(doc, GLOBAL_SECTION);
    return globals ? getValue(globals, key) : undefined;
}
