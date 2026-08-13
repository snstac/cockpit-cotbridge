/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * Editor for the '[cotbridge]' global section — defaults inherited by lanes.
 */

import React, { useEffect, useState } from 'react';
import {
    Card,
    CardBody,
    CardExpandableContent,
    CardHeader,
    CardTitle,
} from '@patternfly/react-core/dist/esm/components/Card/index.js';
import cockpit from 'cockpit';

import type { ToastMessage } from '@snstac/cockpit-shared';

import { parseIni, serializeIni, findSectionFold, getValue, setValue, deleteKey } from './iniFile';
import { ensureGlobalSection, GLOBAL_SECTION } from './lanes';

const _ = cockpit.gettext;

type GlobalDef = {
    key: string;
    label: string;
    help: string;
    type: 'boolean' | 'number' | 'enum';
    options?: Array<{ value: string; label: string }>;
    range?: [number, number];
};

const GLOBAL_DEFS: GlobalDef[] = [
    {
        key: 'debug',
        label: 'DEBUG',
        help: 'Verbose logging for every lane.',
        type: 'boolean',
    },
    {
        key: 'connect_retry_sleep',
        label: 'CONNECT_RETRY_SLEEP',
        help: 'Seconds between reconnect attempts.',
        type: 'number',
        range: [1, 3600],
    },
    {
        key: 'max_in_queue',
        label: 'MAX_IN_QUEUE',
        help: 'Max queued inbound CoT events per lane.',
        type: 'number',
        range: [1, 100000],
    },
    {
        key: 'max_out_queue',
        label: 'MAX_OUT_QUEUE',
        help: 'Max queued outbound CoT events per lane.',
        type: 'number',
        range: [1, 100000],
    },
    {
        key: 'tak_proto',
        label: 'TAK_PROTO',
        help: 'Default payload framing; lanes can override.',
        type: 'enum',
        options: [
            { value: '', label: 'default' },
            { value: '0', label: '0 — XML' },
            { value: '1', label: '1 — Mesh protobuf' },
            { value: '2', label: '2 — Stream protobuf' },
        ],
    },
];

function readGlobals(content: string): Record<string, string> {
    const doc = parseIni(content);
    const section = findSectionFold(doc, GLOBAL_SECTION);
    const out: Record<string, string> = {};
    for (const def of GLOBAL_DEFS)
        out[def.key] = (section && getValue(section, def.key)) ?? '';
    return out;
}

type GlobalsCardProps = {
    content: string;
    busy: boolean;
    onSaveContent: (newContent: string, successTitle: string) => Promise<void>;
    onToast: (t: ToastMessage) => void;
};

export function GlobalsCard({ content, busy, onSaveContent, onToast }: GlobalsCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [form, setForm] = useState<Record<string, string>>(() => readGlobals(content));
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!dirty)
            setForm(readGlobals(content));
    }, [content, dirty]);

    function save() {
        for (const def of GLOBAL_DEFS) {
            const v = form[def.key];
            if (def.type === 'number' && v !== '' && def.range) {
                const n = Number(v);
                if (!/^\d+$/.test(v) || n < def.range[0] || n > def.range[1]) {
                    onToast({
                        variant: 'danger',
                        title: _('{0} must be between {1} and {2}.')
                                .replace('{0}', def.label)
                                .replace('{1}', String(def.range[0]))
                                .replace('{2}', String(def.range[1])),
                    });
                    return;
                }
            }
        }
        const doc = parseIni(content);
        const section = ensureGlobalSection(doc);
        for (const def of GLOBAL_DEFS) {
            const v = (form[def.key] ?? '').trim();
            if (v === '')
                deleteKey(section, def.key);
            else
                setValue(section, def.key, v);
        }
        onSaveContent(serializeIni(doc), _('Global defaults saved.')).then(() => setDirty(false));
    }

    return (
        <Card className="cotbridge-expandable-card" isExpanded={expanded} data-testid="ct-globals-card">
            <CardHeader
                className="ct-card-expandable-header"
                onExpand={() => setExpanded(!expanded)}
                toggleButtonProps={{
                    id: 'ct-globals-expand',
                    'aria-label': expanded ? _('Collapse global defaults') : _('Expand global defaults'),
                }}
            >
                <CardTitle>{_('Global defaults ([cotbridge] section)')}</CardTitle>
            </CardHeader>
            <CardExpandableContent>
                <CardBody>
                    <p>{_('Values here are inherited by every lane unless the lane overrides them. Blank = cotbridge/PyTAK default.')}</p>
                    {GLOBAL_DEFS.map(def => (
                        <div className="cotbridge-field" key={def.key}>
                            <label htmlFor={`ct-global-${def.key}`}>
                                <strong>{def.label}</strong>
                                <div>{def.help}</div>
                            </label>
                            {def.type === 'boolean' && (
                                <select
                                    id={`ct-global-${def.key}`}
                                    value={form[def.key] ?? ''}
                                    onChange={ev => { setForm({ ...form, [def.key]: ev.target.value }); setDirty(true) }}
                                >
                                    <option value="">{_('default (false)')}</option>
                                    <option value="true">true</option>
                                    <option value="false">false</option>
                                </select>
                            )}
                            {def.type === 'number' && (
                                <input
                                    id={`ct-global-${def.key}`}
                                    type="number"
                                    value={form[def.key] ?? ''}
                                    min={def.range?.[0]}
                                    max={def.range?.[1]}
                                    onChange={ev => { setForm({ ...form, [def.key]: ev.target.value }); setDirty(true) }}
                                />
                            )}
                            {def.type === 'enum' && (
                                <select
                                    id={`ct-global-${def.key}`}
                                    value={form[def.key] ?? ''}
                                    onChange={ev => { setForm({ ...form, [def.key]: ev.target.value }); setDirty(true) }}
                                >
                                    {def.options!.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    ))}
                    <button
                        type="button"
                        className="pf-c-button pf-m-primary"
                        disabled={busy || !dirty}
                        onClick={() => save()}
                    >
                        {busy ? _('Saving…') : _('Save global defaults')}
                    </button>
                </CardBody>
            </CardExpandableContent>
        </Card>
    );
}
