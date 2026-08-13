/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * CoT URL validation, mirroring cotbridge's src/cotbridge/config.py so the
 * browser rejects exactly what the daemon would reject at startup.
 */

export type ParsedCotUrl = {
    scheme: string;
    /** Lower-cased hostname, or null when absent (e.g. 'udp://:6969'). */
    hostname: string | null;
    port: number | null;
};

const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i;

/** Minimal urlparse work-alike for 'scheme://host:port' CoT URLs. */
export function parseCotUrl(url: string): ParsedCotUrl {
    const m = url.trim().match(URL_RE);
    if (!m)
        return { scheme: '', hostname: null, port: null };
    const scheme = m[1].toLowerCase();
    let netloc = m[2];
    // Strip userinfo (tak:// enrollment URLs may carry user:token@host).
    const at = netloc.lastIndexOf('@');
    if (at >= 0)
        netloc = netloc.slice(at + 1);

    let host: string | null = null;
    let port: number | null = null;
    if (netloc.startsWith('[')) {
        const end = netloc.indexOf(']');
        host = end > 0 ? netloc.slice(1, end).toLowerCase() : null;
        const rest = end > 0 ? netloc.slice(end + 1) : '';
        if (rest.startsWith(':'))
            port = parsePort(rest.slice(1));
    } else {
        const colon = netloc.lastIndexOf(':');
        if (colon >= 0) {
            host = netloc.slice(0, colon) || null;
            port = parsePort(netloc.slice(colon + 1));
        } else {
            host = netloc || null;
        }
    }
    return { scheme, hostname: host ? host.toLowerCase() : null, port };
}

function parsePort(s: string): number | null {
    if (!/^\d+$/.test(s))
        return null;
    const n = Number(s);
    return n >= 0 && n <= 65535 ? n : null;
}

/** Port of config.validate_cot_url — returns an error string, or null when OK. */
export function validateCotUrl(url: string, lane: string, role: string): string | null {
    const { scheme } = parseCotUrl(url);
    if (!scheme)
        return `Lane '${lane}' ${role} has empty or invalid URL: '${url}'`;

    if (scheme === 'tcp')
        return null;
    if (scheme.includes('udp'))
        return null;
    if (scheme === 'tls' || scheme === 'ssl' || scheme === 'tak')
        return null;
    if (scheme.includes('log') || scheme.includes('file'))
        return null;
    if (scheme.startsWith('tcp+')) {
        return `Lane '${lane}' ${role} uses '${url}': PyTAK does not support scheme '${scheme}'. ` +
            'For TCP listen, PyTAK only supports outbound tcp:// (client). ' +
            'Disable the lane or point feeders at udp+ro:// mesh instead.';
    }
    return `Lane '${lane}' ${role} uses unsupported COT_URL scheme '${scheme}' ('${url}'). ` +
        'See https://pytak.rtfd.io/en/stable/configuration/';
}

function parseUdpScheme(scheme: string): { writeOnly: boolean; readOnly: boolean } {
    const s = scheme.toLowerCase();
    return { writeOnly: s.includes('+wo'), readOnly: s.includes('+ro') };
}

export function normalizeUdpBindHost(host: string | null): string {
    if (!host || host === '0.0.0.0' || host === '*')
        return '0.0.0.0';
    return host.toLowerCase();
}

function udpUrlHostPort(url: string): { host: string | null; port: number | null } {
    const parsed = parseCotUrl(url);
    let host = parsed.hostname;
    const m = url.trim().match(URL_RE);
    const netloc = m ? m[2] : '';
    if (host === null && parsed.port !== null && netloc.startsWith(':'))
        host = '0.0.0.0';
    return { host, port: parsed.port };
}

/** Port of config.normalize_cot_url — upgrades bare all-interface udp:// to udp+ro://. */
export function normalizeCotUrl(url: string): string {
    const raw = url.trim();
    const parsed = parseCotUrl(raw);
    if (!parsed.scheme || !parsed.scheme.includes('udp'))
        return raw;

    const { host, port } = udpUrlHostPort(raw);
    if (host === null || port === null)
        return raw;

    const { writeOnly, readOnly } = parseUdpScheme(parsed.scheme);
    let outScheme = parsed.scheme;
    if (!writeOnly && !readOnly && normalizeUdpBindHost(host) === '0.0.0.0')
        outScheme = 'udp+ro';

    const m = raw.match(URL_RE);
    const tail = m ? raw.slice(m[0].length) : '';
    return `${outScheme}://${host}:${port}${tail}`;
}

/** Port of config.cot_url_udp_bind_endpoint. */
export function cotUrlUdpBindEndpoint(url: string): [string, number] | null {
    const normalized = normalizeCotUrl(url);
    const parsed = parseCotUrl(normalized);
    if (!parsed.scheme.includes('udp'))
        return null;
    const { writeOnly } = parseUdpScheme(parsed.scheme);
    if (writeOnly)
        return null;
    if (parsed.port === null || parsed.hostname === null)
        return null;
    return [normalizeUdpBindHost(parsed.hostname), parsed.port];
}

export type LaneUrls = {
    name: string;
    mode: string;
    ingress: string;
    egress: string;
};

/** Port of config.lane_udp_bind_endpoints. */
export function laneUdpBindEndpoints(lane: LaneUrls): Array<{ side: string; endpoint: [string, number] }> {
    const out: Array<{ side: string; endpoint: [string, number] }> = [];
    const mode = (lane.mode || 'forward')
            .trim()
            .toLowerCase();
    if ((mode === 'forward' || mode === 'duplex') && lane.ingress) {
        const ep = cotUrlUdpBindEndpoint(lane.ingress);
        if (ep)
            out.push({ side: 'ingress', endpoint: ep });
    }
    if ((mode === 'reverse' || mode === 'duplex') && lane.egress) {
        const ep = cotUrlUdpBindEndpoint(lane.egress);
        if (ep)
            out.push({ side: 'egress', endpoint: ep });
    }
    return out;
}

/** Port of config.validate_lane_udp_bind_conflicts — one error string, or null. */
export function validateLaneUdpBindConflicts(lanes: LaneUrls[]): string | null {
    const seen = new Map<string, string[]>();
    for (const lane of lanes) {
        for (const { side, endpoint } of laneUdpBindEndpoints(lane)) {
            const key = `${endpoint[0]}:${endpoint[1]}`;
            const users = seen.get(key) ?? [];
            users.push(`${lane.name} (${side})`);
            seen.set(key, users);
        }
    }
    const parts: string[] = [];
    for (const [endpoint, users] of [...seen.entries()].sort()) {
        if (users.length > 1)
            parts.push(`${endpoint} (${users.join(', ')})`);
    }
    if (!parts.length)
        return null;
    return 'Conflicting UDP bind endpoints across enabled lanes: ' + parts.join('; ') +
        '. Each lane needs a distinct UDP ingress/egress bind, or disable extra lanes.';
}

/** Port of config.validate_loopback_udp_bind_url. */
export function validateLoopbackUdpBindUrl(url: string, lane: string, role: string): string | null {
    const parsed = parseCotUrl(url);
    if (!parsed.scheme.includes('udp'))
        return null;
    const { writeOnly, readOnly } = parseUdpScheme(parsed.scheme);
    if (writeOnly || readOnly)
        return null;
    const host = (parsed.hostname ?? '').toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')
        return null;
    if (parsed.port === null)
        return null;
    return `Lane '${lane}' ${role} uses '${url}': bidirectional udp:// on loopback is ambiguous. ` +
        `To listen for local CoT senders on port ${parsed.port}, use ` +
        `udp+ro://127.0.0.1:${parsed.port} or udp+ro://:${parsed.port} as ${role}_cot_url.`;
}

export function truthy(val: string | undefined | null): boolean {
    if (val === undefined || val === null)
        return false;
    const normalized = String(val)
            .trim()
            .toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}
