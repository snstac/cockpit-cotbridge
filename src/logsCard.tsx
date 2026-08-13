/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    Card,
    CardBody,
    CardExpandableContent,
    CardHeader,
    CardTitle,
} from '@patternfly/react-core/dist/esm/components/Card/index.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

function StatusOutput({ serviceName }: { serviceName: string }) {
    const [statusOutput, setStatusOutput] = useState<string>('Loading...');
    useEffect(() => {
        let cancelled = false;
        async function fetchStatus() {
            try {
                const out = await cockpit.spawn(
                    ['systemctl', 'status', serviceName, '--no-pager'],
                    { superuser: 'try' }
                );
                if (!cancelled) setStatusOutput(out);
            } catch (e: unknown) {
                // systemctl status exits non-zero for inactive/failed units but
                // still prints the useful output on stdout.
                const out = (e as { message?: string })?.message;
                if (!cancelled) setStatusOutput(out || _('Failed to get status output.'));
            }
        }
        fetchStatus();
        const interval = setInterval(fetchStatus, 4000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [serviceName]);
    return <pre className="cotbridge-log-output">{statusOutput}</pre>;
}

export function LogsCard({ serviceName }: { serviceName: string }) {
    const [expanded, setExpanded] = useState(false);
    const [logsOutput, setLogsOutput] = useState<string>('');
    const logFollowProcess = useRef<{ close?:() => void } | null>(null);

    function showServiceLogs(): void {
        cockpit
                .spawn(['journalctl', '-u', serviceName, '--no-pager', '--since', 'today'], {
                    superuser: 'try',
                })
                .then((output: string) => {
                    setLogsOutput(output || _('No logs found for this service.'));
                })
                .catch(() => {
                    setLogsOutput(_('Failed to retrieve service logs.'));
                });
    }

    function stopFollowingLogs(): void {
        if (logFollowProcess.current && typeof logFollowProcess.current.close === 'function') {
            logFollowProcess.current.close();
            logFollowProcess.current = null;
            setLogsOutput(_('Stopped following logs.'));
        } else {
            setLogsOutput(_('Not currently following logs.'));
        }
    }

    function followServiceLogs(): void {
        if (logFollowProcess.current) {
            setLogsOutput(_('Already following logs.'));
            return;
        }
        setLogsOutput('');
        const proc = cockpit.spawn(['journalctl', '-u', serviceName, '-f', '--no-pager'], {
            superuser: 'try',
        });
        logFollowProcess.current = proc;
        proc.stream((data: string) => {
            setLogsOutput(prev => prev + data);
        });
        proc.done(() => {
            logFollowProcess.current = null;
        });
        proc.fail(() => {
            setLogsOutput(_('Failed to follow logs.'));
            logFollowProcess.current = null;
        });
    }

    useEffect(() => {
        return () => {
            if (logFollowProcess.current && typeof logFollowProcess.current.close === 'function')
                logFollowProcess.current.close();
        };
    }, []);

    return (
        <Card className="cotbridge-expandable-card" isExpanded={expanded} data-testid="ct-logs-card">
            <CardHeader
                className="ct-card-expandable-header"
                onExpand={() => setExpanded(!expanded)}
                toggleButtonProps={{
                    id: 'ct-logs-expand',
                    'aria-label': expanded ? _('Collapse debug') : _('Expand debug'),
                }}
            >
                <CardTitle>{_('Debug Logs')}</CardTitle>
            </CardHeader>
            <CardExpandableContent>
                <CardBody>
                    <CardTitle>{_('Status Output')}</CardTitle>
                    <StatusOutput serviceName={serviceName} />
                    <CardTitle>{_('Service Logs')}</CardTitle>
                    <div className="cotbridge-log-actions">
                        <button
                            type="button"
                            className="pf-c-button pf-m-primary"
                            onClick={() => showServiceLogs()}
                        >
                            {_('Show Logs')}
                        </button>
                        <button
                            type="button"
                            className="pf-c-button pf-m-secondary"
                            onClick={() => followServiceLogs()}
                        >
                            {_('Follow Logs')}
                        </button>
                        <button
                            type="button"
                            className="pf-c-button pf-m-secondary"
                            onClick={() => stopFollowingLogs()}
                        >
                            {_('Stop Following')}
                        </button>
                    </div>
                    <pre className="cotbridge-log-output">
                        {logsOutput || _('No logs to display.')}
                    </pre>
                </CardBody>
            </CardExpandableContent>
        </Card>
    );
}
