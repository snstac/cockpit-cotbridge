/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * COTBridge Cockpit application — structured lane management for
 * /etc/cotbridge.ini plus service control, TLS upload, logs, and a raw editor.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Checkbox } from '@patternfly/react-core';

import cockpit from 'cockpit';

import { ServiceManagementCard, TlsUploadCard, type ToastMessage } from '@snstac/cockpit-shared';

import { GlobalsCard } from './globalsCard';
import { type LaneDraft, LanesCard } from './laneCard';
import { LogsCard } from './logsCard';
import { RawConfigCard } from './rawConfigCard';

const _ = cockpit.gettext;

const SERVICE_NAME = 'cotbridge';
const CONFIG_FILE = '/etc/cotbridge.ini';

export const Application: React.FC = () => {
    const [content, setContent] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const [busy, setBusy] = useState(false);
    const [restartAfterSave, setRestartAfterSave] = useState(true);
    const [draft, setDraft] = useState<LaneDraft | null>(null);

    // cockpit.file modify-tag of the last content we read/wrote; used so a
    // concurrent edit (SSH, another session) fails the save instead of being
    // silently overwritten.
    const tagRef = useRef<string | null>(null);
    const fileRef = useRef(cockpit.file(CONFIG_FILE, { superuser: 'try' }));
    const editingRef = useRef(false);
    editingRef.current = draft !== null;

    useEffect(() => {
        const file = fileRef.current;
        const watcher = file.watch((data, tag) => {
            if (data === null) {
                tagRef.current = null;
                if (!editingRef.current) {
                    setContent('');
                    setLoadError(_('{0} does not exist yet — saving a lane will create it.').replace('{0}', CONFIG_FILE));
                }
                return;
            }
            tagRef.current = typeof tag === 'string' ? tag : null;
            if (!editingRef.current) {
                setContent(data);
                setLoadError(null);
            }
        });
        return () => {
            watcher.remove();
            file.close();
        };
    }, []);

    const saveContent = useCallback(async (newContent: string, successTitle: string) => {
        setBusy(true);
        try {
            const tag = await fileRef.current.replace(
                newContent,
                tagRef.current ?? undefined
            );
            tagRef.current = typeof tag === 'string' ? tag : null;
            setContent(newContent);
            setLoadError(null);
            if (restartAfterSave) {
                try {
                    await cockpit.spawn(['systemctl', 'try-restart', `${SERVICE_NAME}.service`], {
                        superuser: 'try',
                        err: 'message',
                    });
                    setToast({ variant: 'success', title: successTitle + ' ' + _('COTBridge restarted.') });
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setToast({
                        variant: 'warning',
                        title: successTitle + ' ' + _('Restart failed: {0}').replace('{0}', msg),
                    });
                }
            } else {
                setToast({
                    variant: 'success',
                    title: successTitle + ' ' + _('Restart cotbridge to apply.'),
                });
            }
        } catch (e: unknown) {
            const problem = (e as { problem?: string })?.problem;
            if (problem === 'change-conflict') {
                setToast({
                    variant: 'warning',
                    title: _('{0} changed on disk — review the current contents and save again.').replace('{0}', CONFIG_FILE),
                });
                // Re-read so the next save works against the fresh tag.
                try {
                    const data = await fileRef.current.read();
                    setContent(data ?? '');
                } catch { /* watch() will catch up */ }
            } else {
                const msg = e instanceof Error ? e.message : String(e);
                setToast({
                    variant: 'danger',
                    title: _('Failed to save {0}: {1}')
                            .replace('{0}', CONFIG_FILE)
                            .replace('{1}', msg),
                });
            }
            throw e;
        } finally {
            setBusy(false);
        }
    }, [restartAfterSave]);

    const saveContentSafe = useCallback(
        (newContent: string, successTitle: string) =>
            saveContent(newContent, successTitle).catch(() => undefined),
        [saveContent]
    );

    const onTlsInstalled = useCallback((paths: { cert?: string; key?: string; ca?: string }) => {
        setDraft(prev => {
            if (!prev)
                return prev;
            return {
                ...prev,
                ...(paths.cert ? { tlsCert: paths.cert } : {}),
                ...(paths.key ? { tlsKey: paths.key } : {}),
                ...(paths.ca ? { tlsCa: paths.ca } : {}),
            };
        });
    }, []);

    const dismissToast = useCallback(() => setToast(null), []);

    return (
        <div data-testid="ct-app">
            <h1>{_('COTBridge')}</h1>
            <p>
                {_('CoT bridge between the local sensor mesh, Mesh SA multicast, and TAK Servers. Configure one lane per route.')}
            </p>

            {toast && (
                <Alert
                    variant={toast.variant}
                    title={toast.title}
                    style={{ marginBottom: '1rem' }}
                    actionClose={
                        <button
                            type="button"
                            className="pf-c-button pf-m-plain"
                            onClick={dismissToast}
                            aria-label={_('Dismiss')}
                        >
                            ×
                        </button>
                    }
                />
            )}

            <ServiceManagementCard serviceName={SERVICE_NAME} onToast={setToast} />

            {loadError && <Alert variant="warning" title={loadError} style={{ marginBlock: '1rem' }} />}

            {content !== null && (
                <div>
                    <div className="cotbridge-save-options">
                        <Checkbox
                            id="ct-restart-after-save"
                            label={_('Restart cotbridge after each save (applies changes if the service is running)')}
                            isChecked={restartAfterSave}
                            onChange={(_ev, checked) => setRestartAfterSave(checked)}
                        />
                    </div>

                    <LanesCard
                        content={content}
                        busy={busy}
                        onSaveContent={saveContentSafe}
                        onToast={setToast}
                        draft={draft}
                        setDraft={setDraft}
                    />

                    <TlsUploadCard
                        tlsDir="/etc/cotbridge/tls"
                        keyUser="cotbridge"
                        testIdPrefix="ct"
                        className="cotbridge-expandable-card"
                        intro={_('With a lane open in the editor, installed paths are filled into its TLS fields.')}
                        onToast={setToast}
                        onInstalledPaths={onTlsInstalled}
                    />

                    <GlobalsCard
                        content={content}
                        busy={busy}
                        onSaveContent={saveContentSafe}
                        onToast={setToast}
                    />

                    <LogsCard serviceName={SERVICE_NAME} />

                    <RawConfigCard
                        configPath={CONFIG_FILE}
                        content={content}
                        busy={busy}
                        onSaveContent={saveContentSafe}
                    />
                </div>
            )}
        </div>
    );
};
