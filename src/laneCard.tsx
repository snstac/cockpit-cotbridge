/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * Structured editor for '[lane:*]' sections of /etc/cotbridge.ini.
 */

import React, { useState } from 'react';
import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import {
    Card,
    CardBody,
    CardTitle,
} from '@patternfly/react-core/dist/esm/components/Card/index.js';
import cockpit from 'cockpit';

import type { ToastMessage } from '@snstac/cockpit-shared';

import {
    type LaneUrls,
    truthy,
    validateCotUrl,
    validateLaneUdpBindConflicts,
    validateLoopbackUdpBindUrl,
} from './cotUrl';
import { parseIni, serializeIni, findSection, getValue } from './iniFile';
import {
    type Lane,
    type LaneEditorKey,
    GLOBAL_SECTION,
    addLane,
    applyLaneValues,
    listLanes,
    removeLane,
    validateLaneName,
} from './lanes';

const _ = cockpit.gettext;

const MODES: Array<{ value: string; label: string }> = [
    { value: 'forward', label: 'forward (ingress → egress)' },
    { value: 'reverse', label: 'reverse (egress → ingress)' },
    { value: 'duplex', label: 'duplex (both directions)' },
];

const TLS_SCHEMES = ['tls', 'ssl', 'tak'];

export type LaneDraft = {
    /** null → adding a new lane. */
    sectionName: string | null;
    name: string;
    enabled: boolean;
    mode: string;
    ingress: string;
    egress: string;
    noHello: boolean;
    takProto: string;
    tlsCert: string;
    tlsKey: string;
    tlsCa: string;
    tlsPassword: string;
    tlsDontVerify: boolean;
    tlsDontCheckHostname: boolean;
    extraKeys: string[];
};

export function draftFromLane(lane: Lane): LaneDraft {
    const v = lane.values;
    return {
        sectionName: lane.sectionName,
        name: lane.name,
        enabled: lane.enabled,
        mode: lane.mode,
        ingress: v.ingress_cot_url ?? '',
        egress: v.egress_cot_url ?? '',
        noHello: truthy(v.pytak_no_hello),
        takProto: v.tak_proto ?? '',
        tlsCert: v.pytak_tls_client_cert ?? '',
        tlsKey: v.pytak_tls_client_key ?? '',
        tlsCa: v.pytak_tls_client_cafile ?? '',
        tlsPassword: v.pytak_tls_client_password ?? '',
        tlsDontVerify: truthy(v.pytak_tls_dont_verify),
        tlsDontCheckHostname: truthy(v.pytak_tls_dont_check_hostname),
        extraKeys: lane.extraKeys,
    };
}

export function newLaneDraft(): LaneDraft {
    return {
        sectionName: null,
        name: '',
        enabled: true,
        mode: 'forward',
        // The AryaOS local CoT hub: feeders publish to udp+wo://127.0.0.1:28087.
        ingress: 'udp+ro://127.0.0.1:28087',
        egress: '',
        noHello: true,
        takProto: '',
        tlsCert: '',
        tlsKey: '',
        tlsCa: '',
        tlsPassword: '',
        tlsDontVerify: false,
        tlsDontCheckHostname: false,
        extraKeys: [],
    };
}

function draftValues(draft: LaneDraft): Partial<Record<LaneEditorKey, string>> {
    return {
        enabled: draft.enabled ? 'true' : 'false',
        mode: draft.mode,
        ingress_cot_url: draft.ingress,
        egress_cot_url: draft.egress,
        pytak_no_hello: draft.noHello ? 'true' : '',
        tak_proto: draft.takProto,
        pytak_tls_client_cert: draft.tlsCert,
        pytak_tls_client_key: draft.tlsKey,
        pytak_tls_client_cafile: draft.tlsCa,
        pytak_tls_client_password: draft.tlsPassword,
        pytak_tls_dont_verify: draft.tlsDontVerify ? 'true' : '',
        pytak_tls_dont_check_hostname: draft.tlsDontCheckHostname ? 'true' : '',
    };
}

export function validateDraft(content: string, draft: LaneDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    const doc = parseIni(content);
    const laneName = draft.sectionName ? draft.name : draft.name.trim();

    if (draft.sectionName === null) {
        const nameErr = validateLaneName(doc, laneName);
        if (nameErr)
            errors.name = nameErr;
    }
    if (!draft.ingress.trim())
        errors.ingress = _('Ingress CoT URL is required.');
    if (!draft.egress.trim())
        errors.egress = _('Egress CoT URL is required.');

    for (const [field, url, role] of [
        ['ingress', draft.ingress, 'ingress'],
        ['egress', draft.egress, 'egress'],
    ] as const) {
        if (!url.trim() || errors[field])
            continue;
        const err = validateCotUrl(url, laneName || 'new', role) ??
            validateLoopbackUdpBindUrl(url, laneName || 'new', role);
        if (err)
            errors[field] = err;
    }
    return errors;
}

/**
 * Apply a draft to the config text and check cross-lane UDP bind conflicts,
 * exactly as the daemon will at startup. Returns the new file content, or an
 * error to show.
 */
export function applyDraft(content: string, draft: LaneDraft): { content?: string; error?: string } {
    const doc = parseIni(content);
    const sectionName = draft.sectionName ?? `lane:${draft.name.trim()}`;
    const section = findSection(doc, sectionName) ?? addLane(doc, draft.name.trim());
    applyLaneValues(section, draftValues(draft));

    const globals = findSection(doc, GLOBAL_SECTION);
    const enabledLanes: LaneUrls[] = listLanes(doc)
            .filter(l => l.enabled)
            .map(l => ({
                name: l.name,
                mode: l.mode,
                ingress: l.values.ingress_cot_url ?? (globals ? getValue(globals, 'ingress_cot_url') : '') ?? '',
                egress: l.values.egress_cot_url ?? (globals ? getValue(globals, 'egress_cot_url') : '') ?? '',
            }));
    const conflict = validateLaneUdpBindConflicts(enabledLanes);
    if (conflict)
        return { error: conflict };
    return { content: serializeIni(doc) };
}

export function deleteLaneFromContent(content: string, sectionName: string): string {
    const doc = parseIni(content);
    removeLane(doc, sectionName);
    return serializeIni(doc);
}

function laneNeedsTls(draft: LaneDraft): boolean {
    const schemes = [draft.ingress, draft.egress]
            .map(u => (u.split('://')[0] || '').toLowerCase());
    if (schemes.some(s => TLS_SCHEMES.includes(s)))
        return true;
    return !!(draft.tlsCert || draft.tlsKey || draft.tlsCa || draft.tlsPassword ||
        draft.tlsDontVerify || draft.tlsDontCheckHostname);
}

function laneFlowSummary(lane: Lane): string {
    const ing = lane.values.ingress_cot_url ?? '(inherited)';
    const egr = lane.values.egress_cot_url ?? '(inherited)';
    if (lane.mode === 'reverse')
        return `${egr} → ${ing}`;
    if (lane.mode === 'duplex')
        return `${ing} ⇄ ${egr}`;
    return `${ing} → ${egr}`;
}

type LaneEditorProps = {
    draft: LaneDraft;
    errors: Record<string, string>;
    onChange: (draft: LaneDraft) => void;
    onSave: () => void;
    onCancel: () => void;
    busy: boolean;
};

function Field({ id, label, help, error, children }: {
    id: string;
    label: string;
    help?: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="cotbridge-field">
            <label htmlFor={id}>
                <strong>{label}</strong>
                {help && <div>{help}</div>}
            </label>
            {children}
            {error && <div className="cotbridge-field-error" role="alert">{error}</div>}
        </div>
    );
}

export function LaneEditor({ draft, errors, onChange, onSave, onCancel, busy }: LaneEditorProps) {
    const isNew = draft.sectionName === null;
    const set = (patch: Partial<LaneDraft>) => onChange({ ...draft, ...patch });

    return (
        <form
            className="cotbridge-lane-editor"
            data-testid="ct-lane-editor"
            onSubmit={ev => { ev.preventDefault(); onSave() }}
        >
            <h3>{isNew ? _('Add lane') : _('Edit lane: {0}').replace('{0}', draft.name)}</h3>

            {isNew && (
                <Field
                    id="ct-lane-name" label={_('Lane name')}
                    help={_('Short identifier, e.g. mesh-to-takserver.')}
                    error={errors.name}
                >
                    <input
                        id="ct-lane-name" type="text" value={draft.name}
                        onChange={ev => set({ name: ev.target.value })}
                    />
                </Field>
            )}

            <Field id="ct-lane-enabled" label={_('Enabled')}>
                <input
                    id="ct-lane-enabled" type="checkbox" checked={draft.enabled}
                    onChange={ev => set({ enabled: ev.target.checked })}
                />
            </Field>

            <Field
                id="ct-lane-mode" label={_('Mode')}
                help={_('Direction CoT flows between the two URLs.')}
            >
                <select
                    id="ct-lane-mode" value={draft.mode}
                    onChange={ev => set({ mode: ev.target.value })}
                >
                    {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
            </Field>

            <Field
                id="ct-lane-ingress" label={_('Ingress CoT URL')}
                help={_('Local side. AryaOS feeders publish to the hub at udp+wo://127.0.0.1:28087; listen there with udp+ro://127.0.0.1:28087.')}
                error={errors.ingress}
            >
                <input
                    id="ct-lane-ingress" type="text" value={draft.ingress}
                    placeholder="udp+ro://127.0.0.1:28087"
                    onChange={ev => set({ ingress: ev.target.value })}
                />
            </Field>

            <Field
                id="ct-lane-egress" label={_('Egress CoT URL')}
                help={_('Remote side: Mesh SA (udp+wo://239.2.3.1:6969), TAK Server (tls://host:8089), or tak:// enrollment URL.')}
                error={errors.egress}
            >
                <input
                    id="ct-lane-egress" type="text" value={draft.egress}
                    placeholder="tls://takserver.example.com:8089"
                    onChange={ev => set({ egress: ev.target.value })}
                />
            </Field>

            <Field
                id="ct-lane-nohello" label={_('Suppress hello event (PYTAK_NO_HELLO)')}
                help={_('Recommended for bridges so cotbridge does not inject its own presence.')}
            >
                <input
                    id="ct-lane-nohello" type="checkbox" checked={draft.noHello}
                    onChange={ev => set({ noHello: ev.target.checked })}
                />
            </Field>

            <Field
                id="ct-lane-takproto" label={_('TAK protocol (TAK_PROTO)')}
                help={_('Payload framing for this lane. Leave as inherited unless the peer requires it.')}
            >
                <select
                    id="ct-lane-takproto" value={draft.takProto}
                    onChange={ev => set({ takProto: ev.target.value })}
                >
                    <option value="">{_('inherited / default')}</option>
                    <option value="0">0 — XML</option>
                    <option value="1">1 — Mesh protobuf</option>
                    <option value="2">2 — Stream protobuf</option>
                </select>
            </Field>

            {laneNeedsTls(draft) && (
                <fieldset className="cotbridge-tls-fieldset">
                    <legend>{_('TLS client identity (for tls:// / ssl:// / tak:// sides)')}</legend>
                    <Field id="ct-lane-tls-cert" label={_('Client certificate (PYTAK_TLS_CLIENT_CERT)')}>
                        <input
                            id="ct-lane-tls-cert" type="text" value={draft.tlsCert}
                            placeholder="/etc/cotbridge/tls/client.crt"
                            onChange={ev => set({ tlsCert: ev.target.value })}
                        />
                    </Field>
                    <Field id="ct-lane-tls-key" label={_('Client key (PYTAK_TLS_CLIENT_KEY)')}>
                        <input
                            id="ct-lane-tls-key" type="text" value={draft.tlsKey}
                            placeholder="/etc/cotbridge/tls/client.key"
                            onChange={ev => set({ tlsKey: ev.target.value })}
                        />
                    </Field>
                    <Field id="ct-lane-tls-ca" label={_('CA bundle (PYTAK_TLS_CLIENT_CAFILE)')}>
                        <input
                            id="ct-lane-tls-ca" type="text" value={draft.tlsCa}
                            placeholder="/etc/cotbridge/tls/ca.crt"
                            onChange={ev => set({ tlsCa: ev.target.value })}
                        />
                    </Field>
                    <Field id="ct-lane-tls-password" label={_('Key password (PYTAK_TLS_CLIENT_PASSWORD)')}>
                        <input
                            id="ct-lane-tls-password" type="password" value={draft.tlsPassword}
                            onChange={ev => set({ tlsPassword: ev.target.value })}
                        />
                    </Field>
                    <Field
                        id="ct-lane-tls-noverify" label={_('Skip certificate verification (PYTAK_TLS_DONT_VERIFY)')}
                        help={_('Testing only — never leave enabled in the field.')}
                    >
                        <input
                            id="ct-lane-tls-noverify" type="checkbox" checked={draft.tlsDontVerify}
                            onChange={ev => set({ tlsDontVerify: ev.target.checked })}
                        />
                    </Field>
                    <Field id="ct-lane-tls-nohostname" label={_('Skip hostname check (PYTAK_TLS_DONT_CHECK_HOSTNAME)')}>
                        <input
                            id="ct-lane-tls-nohostname" type="checkbox" checked={draft.tlsDontCheckHostname}
                            onChange={ev => set({ tlsDontCheckHostname: ev.target.checked })}
                        />
                    </Field>
                </fieldset>
            )}

            {draft.extraKeys.length > 0 && (
                <p className="cotbridge-extra-keys">
                    {_('Other keys preserved as-is:')} <code>{draft.extraKeys.join(', ')}</code>
                </p>
            )}

            <div className="cotbridge-lane-editor-actions">
                <button type="submit" className="pf-c-button pf-m-primary" disabled={busy}>
                    {busy ? _('Saving…') : _('Save lane')}
                </button>
                <button type="button" className="pf-c-button pf-m-secondary" onClick={onCancel} disabled={busy}>
                    {_('Cancel')}
                </button>
            </div>
        </form>
    );
}

type LanesCardProps = {
    content: string;
    busy: boolean;
    onSaveContent: (newContent: string, successTitle: string) => Promise<void>;
    onToast: (t: ToastMessage) => void;
    draft: LaneDraft | null;
    setDraft: (d: LaneDraft | null) => void;
};

export function LanesCard({ content, busy, onSaveContent, onToast, draft, setDraft }: LanesCardProps) {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const lanes = listLanes(parseIni(content));

    async function saveDraft() {
        if (!draft)
            return;
        const fieldErrors = validateDraft(content, draft);
        setErrors(fieldErrors);
        if (Object.keys(fieldErrors).length) {
            onToast({ variant: 'danger', title: _('Fix validation errors before saving.') });
            return;
        }
        const result = applyDraft(content, draft);
        if (result.error) {
            onToast({ variant: 'danger', title: result.error });
            return;
        }
        await onSaveContent(
            result.content!,
            draft.sectionName === null
                ? _('Lane {0} added.').replace('{0}', draft.name.trim())
                : _('Lane {0} saved.').replace('{0}', draft.name)
        );
        setDraft(null);
        setErrors({});
    }

    async function toggleLane(lane: Lane) {
        const d = draftFromLane(lane);
        d.enabled = !d.enabled;
        const result = applyDraft(content, d);
        if (result.error) {
            onToast({ variant: 'danger', title: result.error });
            return;
        }
        await onSaveContent(
            result.content!,
            (d.enabled ? _('Lane {0} enabled.') : _('Lane {0} disabled.')).replace('{0}', lane.name)
        );
    }

    async function deleteLane(lane: Lane) {
        if (!window.confirm(_('Delete lane {0}? This removes its section from /etc/cotbridge.ini.').replace('{0}', lane.name)))
            return;
        await onSaveContent(
            deleteLaneFromContent(content, lane.sectionName),
            _('Lane {0} deleted.').replace('{0}', lane.name)
        );
        if (draft?.sectionName === lane.sectionName)
            setDraft(null);
    }

    return (
        <Card data-testid="ct-lanes-card">
            <CardTitle>{_('Bridge lanes')}</CardTitle>
            <CardBody>
                <p>
                    {_('Each lane relays Cursor on Target between two endpoints. Feeders → Mesh SA is the AryaOS default; add a lane to forward the local CoT stream to a TAK Server.')}
                </p>

                {lanes.length === 0 && (
                    <Alert variant="warning" title={_('No lanes configured — cotbridge will exit at startup.')} />
                )}

                <ul className="cotbridge-lane-list">
                    {lanes.map(lane => (
                        <li key={lane.sectionName} className="cotbridge-lane-row" data-testid={`ct-lane-${lane.name}`}>
                            <div className="cotbridge-lane-head">
                                <span
                                    className={'cotbridge-dot ' + (lane.enabled ? 'is-on' : 'is-off')}
                                    aria-hidden="true"
                                />
                                <strong>{lane.name}</strong>
                                <span className="cotbridge-lane-mode">{lane.mode}</span>
                                {!lane.enabled && <span className="cotbridge-lane-disabled">{_('disabled')}</span>}
                            </div>
                            <code className="cotbridge-lane-flow">{laneFlowSummary(lane)}</code>
                            <div className="cotbridge-lane-actions">
                                <button
                                    type="button" className="pf-c-button pf-m-secondary" disabled={busy}
                                    onClick={() => { setErrors({}); setDraft(draftFromLane(lane)) }}
                                >
                                    {_('Edit')}
                                </button>
                                <button
                                    type="button" className="pf-c-button pf-m-secondary" disabled={busy}
                                    onClick={() => toggleLane(lane)}
                                >
                                    {lane.enabled ? _('Disable') : _('Enable')}
                                </button>
                                <button
                                    type="button" className="pf-c-button pf-m-secondary cotbridge-danger" disabled={busy}
                                    onClick={() => deleteLane(lane)}
                                >
                                    {_('Delete')}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>

                {draft
                    ? (
                        <LaneEditor
                            draft={draft}
                            errors={errors}
                            onChange={setDraft}
                            onSave={() => saveDraft()}
                            onCancel={() => { setDraft(null); setErrors({}) }}
                            busy={busy}
                        />
                    )
                    : (
                        <button
                            type="button"
                            className="pf-c-button pf-m-primary"
                            data-testid="ct-add-lane"
                            disabled={busy}
                            onClick={() => { setErrors({}); setDraft(newLaneDraft()) }}
                        >
                            {_('Add lane')}
                        </button>
                    )}
            </CardBody>
        </Card>
    );
}
