"""Editable source for the GitHub README SVG artwork; no external assets."""
from pathlib import Path
from html import escape

out = Path(__file__).parent
palettes = {
    'light': dict(bg='#FBFAF6', panel='#FFFFFF', ink='#252638', muted='#585D72', indigo='#4654AD', periwinkle='#E3E7FF', coral='#E88775', line='#B6BEDF', approved='#396F60'),
    'dark': dict(bg='#1B1E2D', panel='#252B3D', ink='#F5F2EE', muted='#C7CDDA', indigo='#AFB9FF', periwinkle='#343D66', coral='#F29B8C', line='#68739D', approved='#A9DFCA'),
}

def hero(theme, animated=True):
    c=palettes[theme]
    style='''<style>
    .gather,.proposal,.approve,.solid {opacity:1}
    .disconnected,.dashed {opacity:0}
    @media (prefers-reduced-motion: no-preference) {
      .gather {animation: enter 14s ease-in-out 1 both}
      .proposal {animation: propose 14s ease-in-out 1 both}
      .approve {animation: authorize 14s ease-in-out 1 both}
      .solid {animation: authorize 14s ease-in-out 1 both}
      .disconnected {animation: leave 14s ease-in-out 1 both}
      .dashed {animation: wait 14s ease-in-out 1 both}
    }
    @keyframes enter {0%,14% {opacity:0} 24%,100% {opacity:1}}
    @keyframes propose {0%,29% {opacity:0} 39%,100% {opacity:1}}
    @keyframes authorize {0%,51% {opacity:0} 62%,100% {opacity:1}}
    @keyframes leave {0%,14% {opacity:1} 24%,100% {opacity:0}}
    @keyframes wait {0%,29% {opacity:0} 39%,51% {opacity:1} 62%,100% {opacity:0}}
    </style>''' if animated else ''
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="520" viewBox="0 0 1280 520" role="img" aria-labelledby="title desc">
    <title id="title">FridgeGraph: the village around a child, connected</title><desc id="desc">An illustrative sequence shows a notice, voice message and care note becoming a Rosina proposal. A parent approval turns the proposed connection into an authorized one. It is not live telemetry.</desc>
    {style}<rect width="1280" height="520" rx="24" fill="{c['bg']}"/>
    <rect x="28" y="28" width="1224" height="464" rx="20" fill="none" stroke="{c['line']}" opacity=".58"/>
    <text x="76" y="112" fill="{c['ink']}" font-family="Arial,Helvetica,sans-serif" font-size="58" font-weight="700" letter-spacing="-3">FridgeGraph</text>
    <text x="78" y="151" fill="{c['indigo']}" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="700" letter-spacing="2">ROSINA PREPARES. PARENTS DECIDE.</text>
    <text x="78" y="193" fill="{c['ink']}" font-family="Arial,Helvetica,sans-serif" font-size="27">The village around a child, connected.</text>
    <text x="78" y="437" fill="{c['indigo']}" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700">Powered by Meta Muse</text>
    <text x="78" y="465" fill="{c['muted']}" font-family="Arial,Helvetica,sans-serif" font-size="16">Muse Spark 1.3 · Muse Voice Transcribe 1.0</text>
    <text x="1170" y="465" text-anchor="end" fill="{c['muted']}" font-family="Arial,Helvetica,sans-serif" font-size="13">Meta AI Hackathon · Indie</text>
    <g font-family="Arial,Helvetica,sans-serif" font-size="15" fill="{c['ink']}">
      <g class="disconnected"><path d="M620 279h100M620 328h100M620 377h100" stroke="{c['line']}" stroke-width="2" stroke-dasharray="4 7"/></g>
      <g class="gather"><path d="M620 279C690 279 688 319 748 319M620 328h128M620 377C690 377 688 337 748 337" fill="none" stroke="{c['indigo']}" stroke-width="2.5"/></g>
      <g><rect x="438" y="254" width="182" height="43" rx="10" fill="{c['panel']}" stroke="{c['line']}"/><text x="456" y="281">School notice</text>
      <rect x="438" y="307" width="182" height="43" rx="10" fill="{c['panel']}" stroke="{c['line']}"/><text x="456" y="334">Voice message</text>
      <rect x="438" y="360" width="182" height="43" rx="10" fill="{c['panel']}" stroke="{c['line']}"/><text x="456" y="387">Care note</text></g>
      <circle cx="787" cy="328" r="43" fill="{c['periwinkle']}" stroke="{c['indigo']}" stroke-width="2"/><text x="787" y="324" text-anchor="middle" font-size="15" font-weight="700">Child</text><text x="787" y="343" text-anchor="middle" font-size="12">+ village</text>
      <g class="proposal"><path d="M830 328h47" stroke="{c['indigo']}" stroke-width="2.5"/><rect x="877" y="289" width="139" height="78" rx="12" fill="{c['panel']}" stroke="{c['indigo']}" stroke-width="2"/><text x="946" y="321" text-anchor="middle" font-weight="700">Rosina</text><text x="946" y="342" text-anchor="middle" font-size="13">proposal</text></g>
      <g class="dashed"><path d="M1016 328h83" stroke="{c['coral']}" stroke-width="3" stroke-dasharray="7 7"/></g>
      <g class="solid"><path d="M1016 328h83" stroke="{c['approved']}" stroke-width="4"/></g>
      <g class="approve"><rect x="1099" y="286" width="128" height="84" rx="12" fill="{c['panel']}" stroke="{c['approved']}" stroke-width="2"/><text x="1163" y="318" text-anchor="middle" font-size="14" font-weight="700">Parent</text><text x="1163" y="340" text-anchor="middle" font-size="13">approves</text></g>
    </g>
    <text x="438" y="234" fill="{c['muted']}" font-family="Arial,Helvetica,sans-serif" font-size="13">Illustrative process · no automatic action</text>
    </svg>'''
    (out/('hero-static.svg' if not animated else f'hero-{theme}.svg')).write_text(svg)

for t in palettes: hero(t)
hero('light',False)

badges=[('Explore the demo','explore-the-demo','#4654AD','#FFFFFF'),('See it work','see-it-work','#E88775','#252638'),('Meet Rosina','meet-rosina','#DDE3FF','#252638'),('Architecture','architecture','#252638','#FFFFFF'),('Evidence','evidence','#556E64','#FFFFFF')]
for label,name,bg,fg in badges:
    width=round(len(label)*8.4+32)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="34" viewBox="0 0 {width} 34" role="img" aria-label="{escape(label)}"><rect width="{width}" height="34" rx="7" fill="{bg}"/><text x="{width/2}" y="22" text-anchor="middle" fill="{fg}" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700">{escape(label)}</text></svg>'
    (out/f'nav-{name}.svg').write_text(svg)

roles=[('read','READ','Muse Spark 1.3','#4654AD','#FFFFFF'),('see','SEE','Muse Spark 1.3 vision','#E88775','#252638'),('listen','LISTEN','Muse Voice Transcribe 1.0','#556E64','#FFFFFF')]
for name,role,model,bg,fg in roles:
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="370" height="42" viewBox="0 0 370 42" role="img" aria-label="{escape(role)} — {escape(model)}"><rect width="370" height="42" rx="7" fill="{bg}"/><text x="16" y="27" fill="{fg}" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700">{escape(role)}  ·  {escape(model)}</text></svg>'
    (out/f'role-{name}.svg').write_text(svg)
