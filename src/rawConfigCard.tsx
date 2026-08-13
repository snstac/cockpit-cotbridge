/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * Raw /etc/cotbridge.ini editor — the escape hatch when the structured lane
 * editor does not cover a key. Saves go through the same conflict-checked
 * path as structured edits.
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

const _ = cockpit.gettext;

type RawConfigCardProps = {
    configPath: string;
    content: string;
    busy: boolean;
    onSaveContent: (newContent: string, successTitle: string) => Promise<void>;
};

export function RawConfigCard({ configPath, content, busy, onSaveContent }: RawConfigCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [text, setText] = useState(content);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!dirty)
            setText(content);
    }, [content, dirty]);

    return (
        <Card className="cotbridge-expandable-card" isExpanded={expanded} data-testid="ct-raw-card">
            <CardHeader
                className="ct-card-expandable-header"
                onExpand={() => setExpanded(!expanded)}
                toggleButtonProps={{
                    id: 'ct-raw-expand',
                    'aria-label': expanded ? _('Collapse raw editor') : _('Expand raw editor'),
                }}
            >
                <CardTitle>
                    {_('Raw configuration')} (<code>{configPath}</code>)
                    {dirty ? ` — ${_('unsaved changes')}` : ''}
                </CardTitle>
            </CardHeader>
            <CardExpandableContent>
                <CardBody>
                    <p>{_('Prefer the lane editor above; use this for keys it does not manage.')}</p>
                    <textarea
                        rows={20}
                        spellCheck={false}
                        value={text}
                        data-testid="ct-raw-textarea"
                        onChange={ev => { setText(ev.target.value); setDirty(true) }}
                    />
                    <div className="cotbridge-lane-editor-actions">
                        <button
                            type="button"
                            className="pf-c-button pf-m-primary"
                            disabled={busy || !dirty}
                            onClick={() =>
                                onSaveContent(text, _('Saved {0}.').replace('{0}', configPath))
                                        .then(() => setDirty(false))}
                        >
                            {busy ? _('Saving…') : _('Save raw config')}
                        </button>
                        <button
                            type="button"
                            className="pf-c-button pf-m-secondary"
                            disabled={busy || !dirty}
                            onClick={() => { setText(content); setDirty(false) }}
                        >
                            {_('Discard changes')}
                        </button>
                    </div>
                </CardBody>
            </CardExpandableContent>
        </Card>
    );
}
