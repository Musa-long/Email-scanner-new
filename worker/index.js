const HOSTS = {
  'gmail.com': ['imap.gmail.com', 993],
  'googlemail.com': ['imap.gmail.com', 993],
  'outlook.com': ['outlook.office365.com', 993],
  'hotmail.com': ['outlook.office365.com', 993],
  'live.com': ['outlook.office365.com', 993],
  'yahoo.com': ['imap.mail.yahoo.com', 993],
  'icloud.com': ['imap.mail.me.com', 993],
  'gmx.com': ['imap.gmx.com', 993],
  'zoho.com': ['imap.zoho.com', 993],
  'aol.com': ['imap.aol.com', 993],
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function reader(sock) {
  const r = sock.readable.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    async line(tag, ms = 12000) {
      const deadline = Date.now() + ms;
      while (true) {
        const i = buf.indexOf('\r\n');
        if (i !== -1) {
          const out = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (out.startsWith(tag + ' ') || out.startsWith('* ')) return out;
          continue;
        }
        if (Date.now() > deadline) return 'TIMEOUT';
        const res = await Promise.race([
          r.read(),
          new Promise(res => setTimeout(() => res({ done: true, value: new Uint8Array() }), 3000)),
        ]);
        if (res.value) buf += dec.decode(res.value, { stream: true });
        if (res.done && (!res.value || !res.value.length)) return 'EOF';
      }
    },
  };
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });

    let body;
    try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return json({ ok: false, error: 'missing fields' });

    const host = HOSTS[email.split('@')[1]];
    if (!host) return json({ ok: false, error: 'unsupported domain' });

    let sock;
    try {
      sock = connect({ hostname: host[0], port: host[1] }, { secureTransport: 'on', allowHalfOpen: false });
      const rd = reader(sock);
      const w = sock.writable.getWriter();
      const send = s => w.write(new TextEncoder().encode(s + '\r\n'));

      const greet = await rd.line('', 12000);
      if (!greet.startsWith('* OK')) return json({ ok: false, error: 'no greeting' });

      await send(`a1 LOGIN "${email.replace(/"/g, '')}" "${password.replace(/(["\\])/g, '\\$1')}"`);
      let res = await rd.line('a1', 20000);
      while (res.startsWith('* ')) res = await rd.line('a1', 20000);

      const ok = res.startsWith('a1 OK');
      try { await send('a2 LOGOUT'); } catch {}
      return json({ ok, detail: res.slice(0, 160) });
    } catch (e) {
      return json({ ok: false, error: String(e) });
    } finally {
      try { sock?.close(); } catch {}
    }
  },
};
