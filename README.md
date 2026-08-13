# cockpit-cotbridge — manage your CoT bridge & TAK Server lanes in the browser

A [Cockpit](https://cockpit-project.org/) web console plugin for
[COTBridge](https://github.com/snstac/cotbridge), the **Cursor on Target (CoT) bridge**
that concentrates your sensor fleet's traffic into **one TLS session to TAK Server**
(plus Mesh SA fan-out). Part of the TAK / ATAK / WinTAK situational-awareness stack
for Raspberry Pi and Debian sensor gateways. No SSH required:

* **Structured lane editor** — add, edit, enable/disable, and delete `[lane:*]`
  sections of `/etc/cotbridge.ini` from a form, with the same CoT URL validation
  the daemon applies at startup (PyTAK scheme support, loopback `udp://`
  ambiguity, cross-lane UDP bind conflicts).
* **TLS certificate upload** to `/etc/cotbridge/tls` (`root:cotbridge 0640`),
  with paths applied to the open lane's PyTAK TLS settings.
* **Global defaults editor** for the `[cotbridge]` section.
* **Service control** (start/stop/restart/enable/disable), status, and journal
  tail, plus a raw config editor with save-conflict detection as the escape hatch.

## Install

```sh
sudo curl -fsSL -o /usr/share/keyrings/snstac.gpg https://snstac.github.io/packages/snstac.gpg
sudo curl -fsSL -o /etc/apt/sources.list.d/snstac.sources https://snstac.github.io/packages/snstac.sources
sudo apt update && sudo apt install cockpit-cotbridge cotbridge
```

## Development

React + TypeScript + PatternFly on the Cockpit starter-kit toolchain
(same stack as [cockpit-aiscot](https://github.com/snstac/cockpit-aiscot)):

```sh
make            # fetch pkg/lib + node_modules, build dist/
make check      # eslint, stylelint, tsc, vitest
make devinstall # symlink dist/ into ~/.local/share/cockpit/cotbridge
make package    # deb + rpm via nfpm (uses git describe for VERSION)
```

Releases: push a `v*` tag; CI builds, tests, packages, and uploads deb + rpm.

## The snstac TAK sensor ecosystem

Different sensor, same workflow — pick the gateway for your application; most have a
matching Cockpit plugin for browser-based management:

| Application | Gateway | Cockpit plugin |
|---|---|---|
| Aircraft via ADS-B (1090 MHz / 978 MHz UAT) | [adsbcot](https://github.com/snstac/adsbcot) | [cockpit-adsbcot](https://github.com/snstac/cockpit-adsbcot) |
| Ships & vessels via AIS | [aiscot](https://github.com/snstac/aiscot) | [cockpit-aiscot](https://github.com/snstac/cockpit-aiscot), [cockpit-aiscatcher](https://github.com/snstac/cockpit-aiscatcher) |
| Drone / UAS Remote ID (counter-UAS) | [dronecot](https://github.com/snstac/dronecot) | [cockpit-dronecot](https://github.com/snstac/cockpit-dronecot) |
| Own position via GPS/GNSS | [lincot](https://github.com/snstac/lincot) | [cockpit-lincot](https://github.com/snstac/cockpit-lincot), [cockpit-gps](https://github.com/snstac/cockpit-gps) |
| Radio direction finding (KrakenSDR) | [kraktak](https://github.com/snstac/kraktak) | — |
| APRS amateur radio | [aprscot](https://github.com/snstac/aprscot) | — |
| Weather stations | [windtak](https://github.com/snstac/windtak) | — |
| CoT routing / TAK Server bridging | [cotbridge](https://github.com/snstac/cotbridge) | cockpit-cotbridge (this repo) |

All gateways are built on [PyTAK](https://github.com/snstac/pytak), speak
**Cursor on Target (CoT)** to **ATAK, WinTAK, iTAK, TAK Server, and Mesh SA**, ship as
signed Debian/RPM packages at [snstac.github.io/packages](https://snstac.github.io/packages),
and come pre-installed on [AryaOS](https://github.com/snstac/aryaos), the
situational-awareness OS for Raspberry Pi.
