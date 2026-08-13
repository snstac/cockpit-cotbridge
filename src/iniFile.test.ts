import { describe, expect, it } from 'vitest';

import {
    addSection,
    findSection,
    findSectionFold,
    getValue,
    deleteKey,
    parseIni,
    removeSection,
    sectionValues,
    serializeIni,
    setValue,
} from './iniFile';
import { addLane, applyLaneValues, listLanes, validateLaneName } from './lanes';

const ARYAOS_DEFAULT = `#
# AryaOS COTBridge defaults — local feeders → mesh; TAK Server via Cockpit COTBridge.
# SPDX-License-Identifier: Apache-2.0
#

[cotbridge]
DEBUG = false

[lane:local-to-mesh]
enabled = true
mode = forward
ingress_cot_url = udp+ro://127.0.0.1:28087
egress_cot_url = udp+wo://239.2.3.1:6969
PYTAK_NO_HELLO = true

[lane:local-to-takserver]
enabled = false
mode = forward
ingress_cot_url = udp+ro://127.0.0.1:28087
egress_cot_url = tls://takserver.example.com:8089
PYTAK_NO_HELLO = true
# TLS paths / tak:// enrollment — operator fills via Cockpit COTBridge
`;

describe('parseIni / serializeIni', () => {
    it('round-trips the AryaOS default config byte-for-byte', () => {
        const doc = parseIni(ARYAOS_DEFAULT);
        expect(serializeIni(doc)).toBe(ARYAOS_DEFAULT);
    });

    it('preserves comments, blanks and unknown keys through an edit', () => {
        const doc = parseIni(ARYAOS_DEFAULT);
        const lane = findSection(doc, 'lane:local-to-takserver')!;
        setValue(lane, 'enabled', 'true');
        setValue(lane, 'egress_cot_url', 'tls://tak.example.org:8089');
        const out = serializeIni(doc);
        expect(out).toContain('# SPDX-License-Identifier: Apache-2.0');
        expect(out).toContain('# TLS paths / tak:// enrollment');
        expect(out).toContain('enabled = true\nmode = forward\ningress_cot_url = udp+ro://127.0.0.1:28087\negress_cot_url = tls://tak.example.org:8089');
        // Untouched lane serialized verbatim.
        expect(out).toContain('egress_cot_url = udp+wo://239.2.3.1:6969');
    });

    it('treats option names case-insensitively like ConfigParser', () => {
        const doc = parseIni('[s]\nPYTAK_NO_HELLO = true\n');
        const s = findSection(doc, 's')!;
        expect(getValue(s, 'pytak_no_hello')).toBe('true');
        setValue(s, 'pytak_no_hello', 'false');
        // Updates in place, keeping the original key spelling.
        expect(serializeIni(doc)).toBe('[s]\nPYTAK_NO_HELLO = false\n');
    });

    it('supports colon delimiters and continuation lines on parse', () => {
        const doc = parseIni('[s]\nkey: value\nmulti = one\n    two\n');
        const s = findSection(doc, 's')!;
        expect(getValue(s, 'key')).toBe('value');
        expect(getValue(s, 'multi')).toBe('one\ntwo');
        // Unmodified: round-trips verbatim.
        expect(serializeIni(doc)).toBe('[s]\nkey: value\nmulti = one\n    two\n');
    });

    it('appends new keys after the last entry, before trailing comments', () => {
        const doc = parseIni('[s]\na = 1\n# trailing comment\n');
        setValue(findSection(doc, 's')!, 'b', '2');
        expect(serializeIni(doc)).toBe('[s]\na = 1\nb = 2\n# trailing comment\n');
    });

    it('adds and removes sections with blank-line separation', () => {
        const doc = parseIni('[a]\nx = 1\n');
        const s = addSection(doc, 'lane:new');
        setValue(s, 'enabled', 'true');
        expect(serializeIni(doc)).toBe('[a]\nx = 1\n\n[lane:new]\nenabled = true\n');
        expect(removeSection(doc, 'lane:new')).toBe(true);
        expect(serializeIni(doc)).toBe('[a]\nx = 1\n');
    });

    it('keeps the last duplicate key, matching ConfigParser strict=False reads', () => {
        const doc = parseIni('[s]\na = 1\na = 2\n');
        expect(getValue(findSection(doc, 's')!, 'a')).toBe('2');
    });

    it('deleteKey removes every spelling of the option', () => {
        const doc = parseIni('[s]\nFoo = 1\nfoo = 2\n');
        const s = findSection(doc, 's')!;
        expect(deleteKey(s, 'FOO')).toBe(true);
        expect(serializeIni(doc)).toBe('[s]\n');
    });
});

describe('lanes', () => {
    it('lists lanes with enabled/mode/values/extraKeys', () => {
        const doc = parseIni(ARYAOS_DEFAULT + '\n[lane:x]\nenabled = yes\nCUSTOM = 1\n');
        const lanes = listLanes(doc);
        expect(lanes.map(l => l.name)).toEqual(['local-to-mesh', 'local-to-takserver', 'x']);
        expect(lanes[0].enabled).toBe(true);
        expect(lanes[1].enabled).toBe(false);
        expect(lanes[0].mode).toBe('forward');
        expect(lanes[0].values.ingress_cot_url).toBe('udp+ro://127.0.0.1:28087');
        expect(lanes[2].enabled).toBe(true); // 'yes' is truthy
        expect(lanes[2].extraKeys).toEqual(['custom']);
    });

    it('recognizes mixed-case lane sections like the daemon does', () => {
        const doc = parseIni('[Lane:Foo]\nenabled = 1\n');
        const lanes = listLanes(doc);
        expect(lanes).toHaveLength(1);
        expect(lanes[0].name).toBe('foo');
    });

    it('validates lane names and rejects duplicates case-insensitively', () => {
        const doc = parseIni(ARYAOS_DEFAULT);
        expect(validateLaneName(doc, 'mesh-to-server')).toBeNull();
        expect(validateLaneName(doc, 'local-to-mesh')).toMatch(/already exists/);
        expect(validateLaneName(doc, 'Bad Name')).toMatch(/lowercase/);
        expect(validateLaneName(doc, '')).toMatch(/lowercase/);
        expect(findSectionFold(doc, 'LANE:LOCAL-TO-MESH')).toBeTruthy();
    });

    it('applyLaneValues writes managed keys and drops empties', () => {
        const doc = parseIni('');
        const s = addLane(doc, 'srv');
        applyLaneValues(s, {
            enabled: 'true',
            mode: 'forward',
            ingress_cot_url: 'udp+ro://127.0.0.1:28087',
            egress_cot_url: 'tls://tak.example.com:8089',
            pytak_no_hello: 'true',
            pytak_tls_client_cert: '',
        });
        const vals = sectionValues(s);
        expect(vals.enabled).toBe('true');
        expect(vals.egress_cot_url).toBe('tls://tak.example.com:8089');
        expect('pytak_tls_client_cert' in vals).toBe(false);
        // Re-apply with an empty cert path removes a previously set one.
        setValue(s, 'pytak_tls_client_cert', '/tmp/x.pem');
        applyLaneValues(s, { enabled: 'true', mode: 'forward', pytak_tls_client_cert: '' });
        expect('pytak_tls_client_cert' in sectionValues(s)).toBe(false);
    });
});
