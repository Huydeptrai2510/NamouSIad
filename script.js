/* =====================================================================
   NamouSI – script.js của WEBSITE ADMIN (dự án / domain riêng).
   Dùng cùng một Supabase với website Public. Quyền ghi do RLS + bảng user_roles quyết định,
   KHÔNG phải do việc ẩn giao diện. Ảnh được đẩy lên repo GitHub qua GitHub API.
   ===================================================================== */
(() => {
  'use strict';

  /* ===== 1. CẤU HÌNH – điền 2 giá trị dưới đây =====
     Lấy tại Supabase → Project Settings → API:
       - Project URL
       - anon / publishable key (khóa CÔNG KHAI)
     TUYỆT ĐỐI KHÔNG dán service_role / secret key vào đây. */
  const SUPABASE_URL = '//aulcrgxmrmcgjjiztyuj.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_wzjzypPB3TCdGOkydRzisw_s4D_dlw6';

  /* Kho ảnh GitHub: ảnh được đẩy vào repo của website PUBLIC (thư mục dir) bằng GitHub API.
     Token KHÔNG nằm trong code: nhập ở mục Cài đặt (fine-grained token, chỉ quyền Contents: Read and write cho đúng repo ảnh).
     imgBase: để trống = dùng raw.githubusercontent.com (hiện ngay); hoặc điền domain public, vd 'https://domain-public.com/'. */
  const GH = { owner: 'YOUR-GITHUB-USER', repo: 'YOUR-PUBLIC-REPO', branch: 'main', dir: 'assets', imgBase: '' };
  const PUBLIC_SITE_URL = 'https://YOUR-PUBLIC-DOMAIN/';

  /* ===== 2. TIỆN ÍCH ===== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
  const fmtDate = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString('vi-VN') : '—'; };
  const stateHTML = (type, msg) =>
    `<div class="state state-${type}" role="${type === 'error' ? 'alert' : 'status'}">${type === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : ''}<p>${esc(msg)}</p></div>`;

  function friendlyError(e) {
    const m = String((e && e.message) || e || '');
    const c = e && e.code;
    if (/invalid login credentials/i.test(m)) return 'Email hoặc mật khẩu không đúng.';
    if (/email not confirmed/i.test(m)) return 'Email chưa được xác nhận trong Supabase.';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Không kết nối được tới Supabase. Kiểm tra mạng và SUPABASE_URL.';
    if (/invalid api key|invalid jwt/i.test(m)) return 'API key không hợp lệ. Kiểm tra SUPABASE_ANON_KEY.';
    if (c === '42501' || /row-level security|permission denied/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.';
    if (c === '42P01' || c === 'PGRST205' || /does not exist|schema cache/i.test(m)) return 'Chưa có bảng dữ liệu. Hãy chạy supabase.sql trong Supabase SQL Editor.';
    if (c === '23505' || /duplicate key/i.test(m)) return 'Slug hoặc tên đã tồn tại. Hãy dùng giá trị khác.';
    if (c === '23514') return 'Dữ liệu không hợp lệ (vi phạm ràng buộc của bảng).';
    return 'Đã xảy ra lỗi: ' + m;
  }

  /* ===== 3. SUPABASE CLIENT & TRUY VẤN ===== */
  let client = null;
  let clientError = null;

  function looksSecret(key) {
    if (/^sb_secret_/.test(key)) return true;
    try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; }
    catch (_) { return false; }
  }

  function isConfigured() {
    return /^https?:\/\//i.test(SUPABASE_URL) && !/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY) && SUPABASE_ANON_KEY.length > 20;
  }

  function initClient() {
    if (!isConfigured()) { clientError = 'Chưa cấu hình Supabase. Điền SUPABASE_URL và SUPABASE_ANON_KEY ở đầu file script.js.'; return; }
    if (looksSecret(SUPABASE_ANON_KEY)) { clientError = 'Đây là khóa bí mật (service_role/secret). Không dùng ở frontend. Hãy dùng anon/publishable key.'; return; }
    if (!window.supabase || !window.supabase.createClient) { clientError = 'Không tải được Supabase SDK từ CDN. Kiểm tra kết nối mạng.'; return; }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  }

  async function run(query) {
    try {
      const { data, error, count } = await query;
      if (error) throw error;
      return { data, count, error: null };
    } catch (e) {
      console.error('[NamouSI]', e);
      return { data: null, count: null, error: friendlyError(e) };
    }
  }

  const db = {
    listPublished(table, o = {}) {
      let q = client.from(table).select(o.select || '*').eq('status', 'published');
      Object.entries(o.eq || {}).forEach(([k, v]) => { q = q.eq(k, v); });
      return run(q.order(o.order || 'created_at', { ascending: !!o.asc, nullsFirst: false }).limit(o.limit || 6));
    },
    list: (table, limit = 50) => run(client.from(table).select('*').order('updated_at', { ascending: false }).limit(limit)),
    count: table => run(client.from(table).select('*', { count: 'exact', head: true }))
  };

  /* ===== 5. WEBSITE ADMIN ===== */
  const A = { isAdmin: false, uid: null, rows: {}, ref: { cat: [], tag: [], tool: [] } };
  const VIEWS = { dashboard: 'Tổng quan', ai: 'Quản lý AI', categories: 'Danh mục', tags: 'Tag', prompts: 'Prompt', news: 'Tin tức', users: 'Người dùng', reviews: 'Đánh giá', settings: 'Cài đặt Supabase' };
  const STATS = [['ai_tools', 'AI'], ['ai_models', 'Model AI'], ['categories', 'Danh mục'], ['tags', 'Tag'], ['prompts', 'Prompt'], ['news_articles', 'Tin tức'], ['profiles', 'Người dùng']];
  const UPDATED = ['updated_at', 'Cập nhật'];
  const ST = [['draft', 'Nháp / ẩn'], ['published', 'Xuất bản'], ['archived', 'Lưu trữ']];
  const PM = [['', '— Chưa chọn —'], ['free', 'Miễn phí'], ['freemium', 'Freemium'], ['paid', 'Trả phí'], ['open_source', 'Mã nguồn mở']];
  // Kiểu field: t text | x textarea | l danh sách (mỗi dòng 1 mục) | u url | img url + upload | slug | n số | d ngày | s select | b checkbox
  const F = (k, l, t = 't', o = {}) => ({ k, l, t, ...o });
  const fStatus = F('status', 'Trạng thái', 's', { opts: ST, req: 1, def: 'draft' });
  const MODULES = {
    ai: { table: 'ai_tools', title: 'name', by: 1, pub: 1, link: { table: 'ai_tool_tags', fk: 'ai_tool_id' },
      cols: [['name', 'Tên'], ['slug', 'Slug'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có công cụ AI nào.',
      fields: [F('name', 'Tên AI', 't', { req: 1, max: 120 }), F('slug', 'Slug', 'slug', { max: 80 }), F('tagline', 'Mô tả ngắn', 't', { max: 200 }), F('description', 'Mô tả đầy đủ', 'x', { max: 8000 }),
        F('logo_url', 'Logo (URL hoặc tải ảnh lên)', 'img'), F('screenshot_urls', 'Ảnh giao diện (mỗi dòng 1 URL, hoặc chọn nhiều ảnh để tải lên)', 'l', { url: 1, img: 1 }),
        F('website_url', 'Website chính thức', 'u'), F('developer', 'Nhà phát triển', 't', { max: 120 }),
        F('category_id', 'Danh mục', 's', { opts: 'cat' }), F('pricing_model', 'Loại giá', 's', { opts: PM }),
        F('platforms', 'Nền tảng hỗ trợ (mỗi dòng 1 mục)', 'l'), F('features', 'Tính năng (mỗi dòng 1 mục)', 'l'), F('pros', 'Ưu điểm (mỗi dòng 1 mục)', 'l'), F('cons', 'Nhược điểm (mỗi dòng 1 mục)', 'l'),
        F('api_info', 'API', 't', { max: 300 }), F('pricing_notes', 'Giá và giới hạn gói', 'x', { max: 4000 }), F('sources', 'Nguồn tham khảo (mỗi dòng 1 mục)', 'x', { max: 3000 }), F('verified_at', 'Ngày xác minh', 'd'),
        F('is_featured', 'Đánh dấu nổi bật', 'b'), fStatus] },
    categories: { table: 'categories', title: 'name',
      cols: [['name', 'Tên'], ['slug', 'Slug'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có danh mục nào.',
      fields: [F('name', 'Tên danh mục', 't', { req: 1, max: 80 }), F('slug', 'Slug', 'slug', { max: 80 }), F('description', 'Mô tả', 'x', { max: 500 }), F('icon', 'Icon (emoji, URL ảnh hoặc tải ảnh lên)', 'icon'),
        F('parent_id', 'Danh mục cha', 's', { opts: 'cat' }), F('sort_order', 'Thứ tự', 'n', { def: 0 }), fStatus] },
    tags: { table: 'tags', title: 'name', cols: [['name', 'Tên'], ['slug', 'Slug'], UPDATED], empty: 'Chưa có tag nào.',
      fields: [F('name', 'Tên tag', 't', { req: 1, max: 60 }), F('slug', 'Slug', 'slug', { max: 60 })] },
    prompts: { table: 'prompts', title: 'title', by: 1, pub: 1, link: { table: 'prompt_tags', fk: 'prompt_id' },
      cols: [['title', 'Tiêu đề'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có Prompt nào.',
      fields: [F('title', 'Tên Prompt', 't', { req: 1, max: 160 }), F('slug', 'Slug', 'slug', { max: 80 }), F('description', 'Mô tả', 'x', { max: 600 }), F('content', 'Nội dung Prompt', 'x', { req: 1, max: 20000 }),
        F('category_id', 'Danh mục', 's', { opts: 'cat' }), F('ai_tool_id', 'AI / model tương thích', 's', { opts: 'tool' }),
        F('variables', 'Biến đầu vào (mỗi dòng 1 biến)', 'l'), F('usage_guide', 'Hướng dẫn sử dụng', 'x', { max: 3000 }), F('example', 'Ví dụ sử dụng', 'x', { max: 5000 }),
        F('version', 'Phiên bản', 't', { req: 1, max: 20, def: '1.0' }), F('is_featured', 'Đánh dấu nổi bật', 'b'), fStatus] },
    news: { table: 'news_articles', title: 'title', by: 1, pub: 1,
      cols: [['title', 'Tiêu đề'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có bài viết nào.',
      fields: [F('title', 'Tiêu đề', 't', { req: 1, max: 200 }), F('slug', 'Slug', 'slug', { max: 80 }), F('summary', 'Tóm tắt', 'x', { max: 600 }), F('content', 'Nội dung', 'x', { max: 30000 }),
        F('cover_url', 'Ảnh đại diện (URL hoặc tải ảnh lên)', 'img'), F('source_url', 'Nguồn', 'u'), F('is_featured', 'Đánh dấu nổi bật', 'b'), fStatus] }
  };

  const showScreen = name => {
    $('#screenLoading').hidden = name !== 'loading';
    $('#loginView').hidden = name !== 'login';
    $('#appView').hidden = name !== 'app';
  };
  function setLoginError(msg) {
    const el = $('#loginError');
    el.hidden = !msg;
    el.innerHTML = msg ? `<p>${esc(msg)}</p>` : '';
  }

  async function checkAdmin(uid) {
    const r = await run(client.from('user_roles').select('role').eq('user_id', uid).eq('role', 'admin').limit(1));
    return { error: r.error, isAdmin: !!(r.data && r.data.length) };
  }

  async function routeSession(session) {
    if (!session) { showScreen('login'); return; }
    const r = await checkAdmin(session.user.id);
    if (r.error || !r.isAdmin) {
      await client.auth.signOut();
      showScreen('login');
      setLoginError(r.error || 'Tài khoản này không có quyền quản trị.');
      return;
    }
    A.isAdmin = true; A.uid = session.user.id;
    $('#userEmail').textContent = session.user.email || '';
    showScreen('app');
    setView(location.hash.slice(1));
  }

  async function onLogin(e) {
    e.preventDefault();
    const email = $('#loginEmail').value.trim(), pw = $('#loginPassword').value, btn = $('#loginBtn');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setLoginError('Email không hợp lệ.');
    if (pw.length < 6) return setLoginError('Mật khẩu phải có ít nhất 6 ký tự.');
    setLoginError('');
    btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      await routeSession(data.session);
    } catch (err) {
      setLoginError(friendlyError(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Đăng nhập';
      $('#loginPassword').value = '';
    }
  }

  async function onLogout() {
    A.isAdmin = false; A.rows = {};
    try { sessionStorage.removeItem(GH_KEY); } catch (_) { /* bỏ qua */ }
    try { await client.auth.signOut(); } catch (e) { console.error('[NamouSI]', e); }
    setLoginError('');
    showScreen('login');
  }

  function setView(name) {
    if (!VIEWS[name]) name = 'dashboard';
    $$('[data-view]').forEach(s => { s.hidden = s.dataset.view !== name; });
    $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    $('#viewTitle').textContent = VIEWS[name];
    $('#sidebar').classList.remove('open');
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    if (name === 'dashboard') loadStats();
    else if (MODULES[name]) loadList(name);
    else if (name === 'settings') renderSettings();
  }

  async function loadStats() {
    const grid = $('#statGrid');
    grid.innerHTML = stateHTML('loading', 'Đang tải số liệu...');
    const res = await Promise.all(STATS.map(s => db.count(s[0])));
    const firstErr = res.find(r => r.error);
    grid.innerHTML = STATS.map((s, i) =>
      `<div class="card"><span class="stat-label">${esc(s[1])}</span><strong class="stat-value">${res[i].error ? '—' : res[i].count ?? 0}</strong></div>`
    ).join('') + (firstErr ? stateHTML('error', firstErr.error) : '');
  }

  function cell(key, val) {
    if (key === 'status') return `<span class="badge badge-${esc(val)}">${esc(val)}</span>`;
    if (/_at$/.test(key)) return esc(fmtDate(val));
    return esc(val ?? '—');
  }

  const slugify = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  async function loadRefs() {
    const [c, t, a] = await Promise.all([
      run(client.from('categories').select('id,name').order('name').limit(500)),
      run(client.from('tags').select('id,name').order('name').limit(500)),
      run(client.from('ai_tools').select('id,name').order('name').limit(500))]);
    A.ref = { cat: c.data || [], tag: t.data || [], tool: a.data || [] };
  }

  async function loadList(name) {
    const m = MODULES[name], box = $(`[data-list="${name}"]`);
    box.innerHTML = stateHTML('loading', 'Đang tải dữ liệu...');
    const [r] = await Promise.all([db.list(m.table, 200), loadRefs()]);
    if (r.error) { box.innerHTML = stateHTML('error', r.error); return; }
    A.rows[name] = r.data;
    const fc = $(`[data-view="${name}"] [data-fc]`);
    if (fc) fc.innerHTML = '<option value="">Mọi danh mục</option>' + A.ref.cat.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    renderList(name);
  }

  function renderList(name) {
    const m = MODULES[name], box = $(`[data-list="${name}"]`), sec = box.closest('[data-view]');
    const val = s => { const e = $(s, sec); return e ? e.value : ''; };
    const q = val('[data-q]').trim().toLowerCase(), fs = val('[data-fs]'), fc = val('[data-fc]');
    const all = A.rows[name] || [];
    const rows = all.map((r, i) => [r, i]).filter(([r]) => (!q || [r[m.title], r.slug].some(x => String(x || '').toLowerCase().includes(q))) && (!fs || r.status === fs) && (!fc || r.category_id === fc));
    if (!rows.length) { box.innerHTML = stateHTML('empty', all.length ? 'Không có mục nào khớp bộ lọc.' : m.empty); return; }
    box.innerHTML = `<table class="table"><thead><tr>${m.cols.map(c => `<th>${esc(c[1])}</th>`).join('')}<th></th></tr></thead><tbody>${
      rows.map(([r, i]) => `<tr>${m.cols.map(c => `<td>${cell(c[0], r[c[0]])}</td>`).join('')}<td><div class="adm-actions"><button class="btn btn-sm" type="button" data-edit="${i}">Sửa</button><button class="btn btn-sm" type="button" data-del="${i}">Xóa</button></div></td></tr>`).join('')
    }</tbody></table>`;
  }

  function fieldHTML(f, v, row) {
    const n = esc(f.k), L = esc(f.l) + (f.req ? ' *' : ''), mx = f.max ? ` maxlength="${f.max}"` : '';
    if (f.t === 'b') return `<label class="field adm-check"><input type="checkbox" name="${n}"${v ? ' checked' : ''}> ${L}</label>`;
    let ctl;
    if (f.t === 'x' || f.t === 'l') ctl = `<textarea class="input" name="${n}" rows="${f.t === 'l' ? 3 : 5}"${mx}>${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>`;
    else if (f.t === 's') {
      const o = f.opts === 'cat' ? [['', '— Không chọn —'], ...A.ref.cat.filter(c => !row || c.id !== row.id).map(c => [c.id, c.name])]
        : f.opts === 'tool' ? [['', '— Không chọn —'], ...A.ref.tool.map(c => [c.id, c.name])] : f.opts;
      ctl = `<select class="input" name="${n}">${o.map(([k, t]) => `<option value="${esc(k)}"${(v ?? '') === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    } else {
      const type = { u: 'url', img: 'url', d: 'date', n: 'number' }[f.t] || 'text';
      ctl = `<input class="input" name="${n}" type="${type}"${mx}${f.t === 'slug' ? ' placeholder="Để trống để tự tạo từ tên"' : ''} value="${esc(f.t === 'd' ? String(v || '').slice(0, 10) : v)}">`;
    }
    if (f.t === 'img' || f.t === 'icon' || f.img) ctl += `<input class="input" type="file" accept="image/png,image/jpeg,image/webp"${f.t === 'l' ? ' multiple data-multi' : ''} data-upload="${n}"><span class="muted" data-upstat>Ảnh được đẩy lên GitHub. PNG, JPG hoặc WebP, tối đa 2 MB mỗi ảnh.</span>`;
    return `<label class="field">${L}${ctl}</label>`;
  }

  function readForm(m, form) {
    const v = {}, errs = [];
    m.fields.forEach(f => {
      const el = form.elements[f.k];
      if (f.t === 'b') { v[f.k] = el.checked; return; }
      let x = el.value.trim();
      if (f.t === 'l') {
        x = x.split('\n').map(i => i.trim()).filter(Boolean);
        if (x.length > 20) errs.push(`${f.l}: tối đa 20 dòng.`);
        if (x.some(i => i.length > 300 || (f.url && !safeUrl(i)))) errs.push(f.url ? `${f.l}: mỗi dòng phải là URL http(s).` : `${f.l}: mỗi dòng tối đa 300 ký tự.`);
        v[f.k] = x; return;
      }
      if (f.t === 'slug' && !x) x = slugify(v[m.title]);
      if (f.t === 'icon') { if (/^https?:/i.test(x)) { if (!safeUrl(x) || x.length > 500) errs.push(`${f.l}: URL không hợp lệ.`); } else if (x.length > 8) errs.push(`${f.l}: emoji/chữ tối đa 8 ký tự, hoặc dùng URL ảnh.`); }
      if (f.req && !x) errs.push(`${f.l} là bắt buộc.`);
      if (f.max && x.length > f.max) errs.push(`${f.l} tối đa ${f.max} ký tự.`);
      if (x && (f.t === 'u' || f.t === 'img') && !safeUrl(x)) errs.push(`${f.l} phải là URL bắt đầu bằng http:// hoặc https://.`);
      if (f.t === 'slug' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(x)) errs.push('Slug chỉ gồm chữ thường, số và dấu gạch ngang (không được để trống).');
      if (f.t === 'n') { const num = Number(x || 0); if (!Number.isInteger(num) || num < 0 || num > 9999) errs.push(`${f.l} phải là số nguyên từ 0 đến 9999.`); x = num; }
      v[f.k] = x === '' ? null : x;
    });
    return { v, errs };
  }

  const formError = msg => { const e = $('#formError'); if (e) { e.hidden = !msg; e.innerHTML = msg ? `<p>${esc(msg)}</p>` : ''; if (msg) e.scrollIntoView({ block: 'nearest' }); } };

  async function openForm(name, idx) {
    const m = MODULES[name], row = idx == null ? null : (A.rows[name] || [])[idx], body = $('#modalBody');
    $('#modalTitle').textContent = row ? 'Sửa: ' + (row[m.title] || '') : 'Thêm mới';
    body.innerHTML = stateHTML('loading', 'Đang tải biểu mẫu...');
    $('#modal').hidden = false;
    const ctx = { id: row && row.id, row, linked: [] };
    if (row && m.link) {
      const r = await run(client.from(m.link.table).select('tag_id').eq(m.link.fk, row.id));
      if (r.error) { body.innerHTML = stateHTML('error', r.error); return; }
      ctx.linked = r.data.map(x => x.tag_id);
    }
    const tags = m.link ? `<fieldset class="field"><legend>Tag</legend><div class="chips">${A.ref.tag.length ? A.ref.tag.map(t => `<label class="chip"><input type="checkbox" name="_tags" value="${esc(t.id)}"${ctx.linked.includes(t.id) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('') : '<span class="muted">Chưa có tag. Hãy tạo ở mục Tag.</span>'}</div></fieldset>` : '';
    body.innerHTML = `<form id="crudForm" novalidate><div class="state state-error" id="formError" role="alert" hidden></div>${m.fields.map(f => fieldHTML(f, row ? row[f.k] : f.def, row)).join('')}${tags}<div class="adm-form-actions"><button class="btn" type="button" data-close>Hủy</button><button class="btn btn-primary" type="submit">Lưu</button></div></form>`;
    const form = $('#crudForm');
    form.addEventListener('submit', e => { e.preventDefault(); saveForm(name, ctx, form); });
    form.addEventListener('change', e => { if (e.target.matches('[data-upload]')) onUpload(e.target); });
  }

  /* --- Ảnh trên GitHub --- */
  const GH_KEY = 'namousi_gh_token';
  const IMG_DIR = { logo_url: 'logos', screenshot_urls: 'screenshots', icon: 'icons', cover_url: 'covers' };
  const ghOk = () => !/YOUR-/.test(GH.owner + GH.repo);
  const ghGet = () => { try { return sessionStorage.getItem(GH_KEY) || localStorage.getItem(GH_KEY) || ''; } catch (_) { return ''; } };
  const ghSet = (t, keep) => { try { sessionStorage.removeItem(GH_KEY); localStorage.removeItem(GH_KEY); if (t) (keep ? localStorage : sessionStorage).setItem(GH_KEY, t); } catch (_) { /* trình duyệt chặn storage */ } };
  const ghFetch = (path, init = {}) => fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}${path}`, { ...init, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + ghGet(), ...(init.headers || {}) } });
  const toB64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => no(r.error); r.readAsDataURL(file); });

  async function uploadImage(file, dir) {
    const bad = m => Object.assign(new Error(m), { ui: m });
    if (!ghOk()) throw bad('Chưa cấu hình GH (owner, repo) ở đầu script.js.');
    if (!ghGet()) throw bad('Chưa có GitHub token. Vào mục Cài đặt để nhập trước khi tải ảnh.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw bad(`“${file.name}”: chỉ nhận PNG, JPG hoặc WebP.`);
    if (file.size > 2 * 1024 * 1024) throw bad(`“${file.name}” vượt quá 2 MB.`);
    const path = `${GH.dir}/${dir}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`;
    let res;
    try { res = await ghFetch('/contents/' + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Thêm ảnh ' + path, content: await toB64(file), branch: GH.branch }) }); }
    catch (_) { throw bad('Không kết nối được GitHub. Kiểm tra mạng.'); }
    if (!res.ok) throw bad(res.status === 401 ? 'GitHub token sai hoặc đã hết hạn.' : res.status === 403 || res.status === 404 ? 'Token không có quyền ghi vào repo ảnh (cần Contents: Read and write) hoặc sai owner/repo.' : res.status === 422 ? 'Branch không tồn tại hoặc file bị trùng.' : `GitHub trả lỗi ${res.status}.`);
    return (GH.imgBase || `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}/`) + path;
  }

  async function onUpload(inp) {
    const files = [...inp.files], key = inp.dataset.upload, multi = inp.hasAttribute('data-multi');
    const st = inp.parentElement.querySelector('[data-upstat]'), el = $(`#crudForm [name="${key}"]`), urls = [];
    if (!files.length) return;
    inp.disabled = true; formError('');
    try {
      for (const [i, f] of files.entries()) { st.textContent = `Đang tải ảnh ${i + 1}/${files.length} lên GitHub...`; urls.push(await uploadImage(f, IMG_DIR[key] || 'misc')); }
      st.textContent = `Đã tải ${urls.length} ảnh. Nhớ bấm Lưu.`;
    } catch (e) { st.textContent = urls.length ? `Đã tải ${urls.length} ảnh trước khi gặp lỗi.` : ''; formError(e.ui || friendlyError(e)); }
    if (urls.length) el.value = multi ? [el.value.trim(), ...urls].filter(Boolean).join('\n') : urls[0];
    inp.disabled = false; inp.value = '';
  }

  function renderGh() {
    $('#ghRepo').textContent = ghOk() ? `${GH.owner}/${GH.repo} (nhánh ${GH.branch}, thư mục ${GH.dir}/)` : 'Chưa cấu hình – sửa GH ở đầu script.js';
    $('#ghState').textContent = ghGet() ? 'Đã nhập' : 'Chưa nhập';
  }

  async function saveGh() {
    const out = $('#ghResult'), t = $('#ghToken').value.trim(), msg = (ty, m) => { out.innerHTML = stateHTML(ty, m); };
    if (!ghOk()) return msg('error', 'Chưa cấu hình GH (owner, repo) ở đầu script.js.');
    if (!/^(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}$/.test(t)) return msg('error', 'Token không đúng định dạng. Hãy tạo fine-grained token trên GitHub.');
    ghSet(t, $('#ghRemember').checked);
    $('#ghToken').value = '';
    msg('loading', 'Đang kiểm tra token...');
    try {
      const res = await ghFetch('');
      if (!res.ok) { ghSet(''); msg('error', res.status === 401 ? 'Token sai hoặc đã hết hạn.' : `Token không truy cập được repo ${GH.owner}/${GH.repo}. Kiểm tra owner/repo và quyền của token.`); }
      else { const j = await res.json(); if (j.permissions && j.permissions.push === false) msg('error', 'Token đọc được repo nhưng KHÔNG có quyền ghi (cần Contents: Read and write).'); else msg('ok', 'Token hợp lệ. Quyền ghi sẽ được xác nhận khi tải ảnh đầu tiên.'); }
    } catch (_) { msg('error', 'Không kết nối được GitHub. Kiểm tra mạng.'); }
    renderGh();
  }

  async function saveForm(name, ctx, form) {
    const m = MODULES[name], btn = $('button[type="submit"]', form), { v, errs } = readForm(m, form);
    if (errs.length) return formError(errs.join(' '));
    formError('');
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    const fail = msg => { formError(msg); btn.disabled = false; btn.textContent = 'Lưu'; };
    if (m.pub && v.status === 'published' && !(ctx.row && ctx.row.published_at)) v.published_at = new Date().toISOString();
    let r;
    if (ctx.id) r = await run(client.from(m.table).update(v).eq('id', ctx.id).select('id').single());
    else { if (m.by) v.created_by = A.uid; r = await run(client.from(m.table).insert(v).select('id').single()); }
    if (r.error) return fail(r.error);
    ctx.id = r.data.id;
    if (m.link) {
      const ids = $$('input[name="_tags"]:checked', form).map(i => i.value);
      const del = ctx.linked.filter(t => !ids.includes(t)), add = ids.filter(t => !ctx.linked.includes(t));
      let e = null;
      if (del.length) e = (await run(client.from(m.link.table).delete().eq(m.link.fk, ctx.id).in('tag_id', del))).error;
      if (!e && add.length) e = (await run(client.from(m.link.table).insert(add.map(t => ({ [m.link.fk]: ctx.id, tag_id: t }))))).error;
      if (e) { loadList(name); return fail('Đã lưu nội dung nhưng gắn tag bị lỗi: ' + e); }
    }
    closeModal();
    loadList(name);
  }

  async function delRow(name, idx) {
    const m = MODULES[name], row = (A.rows[name] || [])[idx];
    if (!row || !confirm(`Xóa “${row[m.title]}”? Thao tác này không thể hoàn tác.`)) return;
    const r = await run(client.from(m.table).delete().eq('id', row.id).select('id'));
    if (r.error) alert(r.error);
    else if (!r.data.length) alert('Không xóa được (không có quyền hoặc mục đã bị xóa).');
    loadList(name);
  }
  const closeModal = () => { $('#modal').hidden = true; };

  async function renderSettings() {
    renderGh();
    let host = '—';
    try { host = new URL(SUPABASE_URL).host; } catch (_) { /* giữ mặc định */ }
    $('#cfgUrl').textContent = host;
    $('#cfgKey').textContent = isConfigured() ? 'Đã nhập (khóa công khai)' : 'Chưa nhập';
    const { data } = await client.auth.getUser();
    $('#cfgUser').textContent = (data && data.user && data.user.email) || '—';
  }

  async function testConnection() {
    const out = $('#testResult'), btn = $('#testBtn');
    btn.disabled = true;
    out.innerHTML = stateHTML('loading', 'Đang kiểm tra kết nối...');
    const r = await db.count('categories');
    out.innerHTML = r.error ? stateHTML('error', r.error) : stateHTML('ok', 'Kết nối thành công. Đọc được bảng categories.');
    btn.disabled = false;
  }

  async function initAdmin() {
    if (!$('#appView')) return;
    $('#ghSave').addEventListener('click', saveGh);
    $('#ghClear').addEventListener('click', () => { ghSet(''); $('#ghResult').innerHTML = ''; renderGh(); });
    if (/^https?:\/\//i.test(PUBLIC_SITE_URL) && !/YOUR-/.test(PUBLIC_SITE_URL)) { const h = $('#homeLink'); h.href = PUBLIC_SITE_URL; h.hidden = false; }
    $('#loginForm').addEventListener('submit', onLogin);
    $('#logoutBtn').addEventListener('click', onLogout);
    $('#testBtn').addEventListener('click', testConnection);
    $('#sidebarBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    ['input', 'change'].forEach(ev => $('#appView').addEventListener(ev, e => {
      const sec = e.target.closest('[data-view]');
      if (sec && e.target.matches('[data-q],[data-fs],[data-fc]') && MODULES[sec.dataset.view] && A.rows[sec.dataset.view]) renderList(sec.dataset.view);
    }));
    window.addEventListener('hashchange', () => { if (A.isAdmin) setView(location.hash.slice(1)); });
    $('#appView').addEventListener('click', e => {
      const nav = e.target.closest('[data-nav],[data-refresh]');
      if (nav) return setView(nav.dataset.nav || nav.dataset.refresh);
      const act = e.target.closest('[data-add],[data-edit],[data-del]');
      if (!act) return;
      const name = act.dataset.add || act.closest('[data-view]').dataset.view;
      if (act.dataset.add) openForm(name);
      else if (act.dataset.edit !== undefined) openForm(name, Number(act.dataset.edit));
      else delRow(name, Number(act.dataset.del));
    });

    if (!client) {
      showScreen('login');
      setLoginError(clientError);
      $('#loginBtn').disabled = true;
      return;
    }
    // Đăng xuất / hết phiên ở tab khác hoặc token hết hạn → quay về màn đăng nhập
    client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' && A.isAdmin) { A.isAdmin = false; showScreen('login'); }
    });
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await routeSession(data.session);
    } catch (e) {
      showScreen('login');
      setLoginError(friendlyError(e));
    }
  }

  /* ===== 6. KHỞI CHẠY ===== */
  document.addEventListener('DOMContentLoaded', () => { initClient(); initAdmin(); });
})();
