# Corrected dense Village + dark check-in live capture

Captured through port 5189, real picker-issued Kendra session, focus mode. Frozen HEAD `40d1c060a46dcb62eb938249faead8b9fbf15b48`; UI source change `3a0cadd2c6727ff589f3f44de5c024bab52acaa9`. Backend `e3f2e3b`; Bentley reports schema 0049–0052, no migration applied during refresh. Window W-CAP-SIGNATURE-DENSITY, deadline 18:30Z / handback 18:28Z. DONE sent to Bentley at 18:13Z; no further live requests.

## Results

26 checks PASS. Actual authorized dense Village at 1440 and 390, light/dark: no intersecting label/portrait bounding boxes; every authorized identity remains accessible through +N and list view; real person detail docks below the network; no Sample data on the live route. Mobile screenshots include internal-scroll segments because full-page screenshots alone cannot show that scrolling viewport. Dark check-in captured at both widths. Zero graph mutations, no alerts opened, no reset, seed or service restart. In-process token scan PASS (filenames + pass/fail only in the JSON receipt); no traces, HAR, video, storage state or header logging.

## Approved correction, original failure preserved

`density-live-01.json` is unchanged and records the original failed contrast assertion. Its parser wrongly interpreted computed OKLCH values as RGB. Bryan explicitly approved correcting conversion while retaining the 4.5:1 threshold. The corrected run uses the browser's canvas sRGB conversion before WCAG luminance calculation. It cites the original receipt in `correctsReceipt`. Independent takes 02/03 proved geometry and saved captures while leaving contrast explicitly pending; neither is substituted for this complete corrected run.

At BOTH 1440 and 390:

| Measurement | Ratio | Gate |
| --- | --- | --- |
| High control: OKLCH white / black | 21.00:1 | PASS |
| Low control: OKLCH .6 / .65 neutral | 1.2212:1 | FAIL as required |
| Dark check-in heading | 15.7156:1 | PASS at 4.5:1 |
| Dark check-in body | 15.7156:1 | PASS at 4.5:1 |
| Dark check-in action | 15.7156:1 | PASS at 4.5:1 |

No threshold loosened, no color changes needed. Corrected capture script ran from a temporary harness while UI source stayed frozen; the exact corrected harness is retained in the PR after the window. The receipt records the captured commit, not a later documentation/harness-only commit.

## Wording ownership and remaining work

Premature “prepared a preview” is model-generated output, not a literal source string. Browser copy at `web/src/features/rosina/RosinaPanel.tsx:87–88` already says it CAN prepare; OrbitView only presents exact-preview wording after successful matching version/hash readiness. Server prompt drift remains at `src/rosina/systemPrompt.ts:88–89` and `:268–272`; reported to Claude Code, not edited here. Stronger shared glass and the separately requested Orbit Alert redesign remain later work; design.md §10 is deliberately not rewritten in #61.

## Bentley release

Canonical HANDOFF records RELEASED at18:14: independent read-only verification found alerts0, responses0 and created families0; cast unchanged; stack HEALTHY,0 failing. No reset was necessary. No window remains open.
