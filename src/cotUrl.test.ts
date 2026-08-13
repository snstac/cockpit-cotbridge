import { describe, expect, it } from 'vitest';

import {
    cotUrlUdpBindEndpoint,
    laneUdpBindEndpoints,
    normalizeCotUrl,
    parseCotUrl,
    truthy,
    validateCotUrl,
    validateLaneUdpBindConflicts,
    validateLoopbackUdpBindUrl,
} from './cotUrl';

describe('parseCotUrl', () => {
    it('parses scheme/host/port including +wo/+ro schemes', () => {
        expect(parseCotUrl('udp+wo://239.2.3.1:6969')).toEqual({ scheme: 'udp+wo', hostname: '239.2.3.1', port: 6969 });
        expect(parseCotUrl('tls://TAKserver.Example.com:8089')).toEqual({ scheme: 'tls', hostname: 'takserver.example.com', port: 8089 });
        expect(parseCotUrl('udp://:18087')).toEqual({ scheme: 'udp', hostname: null, port: 18087 });
        expect(parseCotUrl('tcp://127.0.0.1:8087')).toEqual({ scheme: 'tcp', hostname: '127.0.0.1', port: 8087 });
        expect(parseCotUrl('nonsense')).toEqual({ scheme: '', hostname: null, port: null });
    });

    it('handles tak:// enrollment URLs with userinfo and query', () => {
        const p = parseCotUrl('tak://com.atakmap.app/enroll?host=tak.example.com&username=U&token=T');
        expect(p.scheme).toBe('tak');
        expect(p.hostname).toBe('com.atakmap.app');
    });
});

describe('validateCotUrl (mirrors cotbridge config.validate_cot_url)', () => {
    it('accepts tcp, udp variants, tls/ssl/tak, log and file schemes', () => {
        for (const url of [
            'tcp://127.0.0.1:8087',
            'udp://239.2.3.1:6969',
            'udp+wo://239.2.3.1:6969',
            'udp+ro://:18087',
            'udp+broadcast://255.255.255.255:4349',
            'tls://tak.example.com:8089',
            'ssl://tak.example.com:8089',
            'tak://com.atakmap.app/enroll?host=h&username=u&token=t',
            'log://stdout',
            'file:///tmp/cot.log',
        ])
            expect(validateCotUrl(url, 'l', 'ingress')).toBeNull();
    });

    it('rejects tcp+ listen schemes with the PyTAK guidance', () => {
        const err = validateCotUrl('tcp+ppt://:8087', 'l', 'ingress');
        expect(err).toMatch(/PyTAK does not support scheme 'tcp\+ppt'/);
    });

    it('rejects unknown schemes and empty URLs', () => {
        expect(validateCotUrl('quic://h:1', 'l', 'egress')).toMatch(/unsupported COT_URL scheme 'quic'/);
        expect(validateCotUrl('', 'l', 'egress')).toMatch(/empty or invalid URL/);
        expect(validateCotUrl('not-a-url', 'l', 'egress')).toMatch(/empty or invalid URL/);
    });
});

describe('normalizeCotUrl (mirrors config.normalize_cot_url)', () => {
    it('upgrades all-interface bare udp:// to udp+ro://', () => {
        expect(normalizeCotUrl('udp://:18087')).toBe('udp+ro://0.0.0.0:18087');
        expect(normalizeCotUrl('udp://0.0.0.0:18087')).toBe('udp+ro://0.0.0.0:18087');
    });

    it('leaves modified schemes, non-udp, and host-specific udp alone', () => {
        expect(normalizeCotUrl('udp+wo://239.2.3.1:6969')).toBe('udp+wo://239.2.3.1:6969');
        expect(normalizeCotUrl('udp+ro://127.0.0.1:28087')).toBe('udp+ro://127.0.0.1:28087');
        expect(normalizeCotUrl('udp://239.2.3.1:6969')).toBe('udp://239.2.3.1:6969');
        expect(normalizeCotUrl('tls://h:8089')).toBe('tls://h:8089');
        expect(normalizeCotUrl('udp://noport')).toBe('udp://noport');
    });
});

describe('cotUrlUdpBindEndpoint (mirrors config.cot_url_udp_bind_endpoint)', () => {
    it('returns bind endpoints for reading udp URLs only', () => {
        expect(cotUrlUdpBindEndpoint('udp+ro://127.0.0.1:28087')).toEqual(['127.0.0.1', 28087]);
        expect(cotUrlUdpBindEndpoint('udp://:18087')).toEqual(['0.0.0.0', 18087]);
        expect(cotUrlUdpBindEndpoint('udp://239.2.3.1:6969')).toEqual(['239.2.3.1', 6969]);
        expect(cotUrlUdpBindEndpoint('udp+wo://239.2.3.1:6969')).toBeNull();
        expect(cotUrlUdpBindEndpoint('tcp://127.0.0.1:8087')).toBeNull();
        expect(cotUrlUdpBindEndpoint('tls://h:8089')).toBeNull();
    });
});

describe('lane bind endpoints and conflicts', () => {
    const mesh = { name: 'local-to-mesh', mode: 'forward', ingress: 'udp+ro://127.0.0.1:28087', egress: 'udp+wo://239.2.3.1:6969' };

    it('forward lanes bind ingress; reverse lanes bind egress; duplex both', () => {
        expect(laneUdpBindEndpoints(mesh)).toEqual([{ side: 'ingress', endpoint: ['127.0.0.1', 28087] }]);
        expect(laneUdpBindEndpoints({ name: 'r', mode: 'reverse', ingress: 'udp+wo://1.2.3.4:1', egress: 'udp+ro://239.2.3.1:6969' }))
                .toEqual([{ side: 'egress', endpoint: ['239.2.3.1', 6969] }]);
        expect(laneUdpBindEndpoints({ name: 'd', mode: 'duplex', ingress: 'udp://:1111', egress: 'udp://:2222' }))
                .toHaveLength(2);
    });

    it('flags two enabled lanes binding the same endpoint', () => {
        const dup = { name: 'srv', mode: 'forward', ingress: 'udp+ro://127.0.0.1:28087', egress: 'tls://h:8089' };
        const err = validateLaneUdpBindConflicts([mesh, dup]);
        expect(err).toMatch(/127\.0\.0\.1:28087 \(local-to-mesh \(ingress\), srv \(ingress\)\)/);
    });

    it('passes distinct binds and write-only egress lanes', () => {
        const srv = { name: 'srv', mode: 'forward', ingress: 'udp+ro://127.0.0.1:29087', egress: 'tls://h:8089' };
        expect(validateLaneUdpBindConflicts([mesh, srv])).toBeNull();
    });
});

describe('validateLoopbackUdpBindUrl', () => {
    it('rejects bidirectional udp:// on loopback with the udp+ro hint', () => {
        const err = validateLoopbackUdpBindUrl('udp://127.0.0.1:28087', 'l', 'ingress');
        expect(err).toMatch(/udp\+ro:\/\/127\.0\.0\.1:28087/);
    });

    it('accepts +ro/+wo loopback and non-loopback udp', () => {
        expect(validateLoopbackUdpBindUrl('udp+ro://127.0.0.1:28087', 'l', 'ingress')).toBeNull();
        expect(validateLoopbackUdpBindUrl('udp+wo://127.0.0.1:28087', 'l', 'ingress')).toBeNull();
        expect(validateLoopbackUdpBindUrl('udp://239.2.3.1:6969', 'l', 'ingress')).toBeNull();
        expect(validateLoopbackUdpBindUrl('tls://h:8089', 'l', 'ingress')).toBeNull();
    });
});

describe('truthy', () => {
    it('matches cotbridge config.truthy semantics', () => {
        for (const v of ['1', 'true', 'YES', ' on '])
            expect(truthy(v)).toBe(true);
        for (const v of ['0', 'false', 'no', 'off', '', undefined, null])
            expect(truthy(v)).toBe(false);
    });
});
