(function(){
  'use strict';
  if (window.ST_PREVIEW !== true) return;

  const state = { lastError: null, session: null, api: null, checkedAt: null };
  const esc = value => String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));

  function panelHtml(){
    const e = state.lastError ? esc(state.lastError) : '—';
    const session = state.session === true ? 'OK — Supabase session создана' : state.session === false ? 'НЕТ — Supabase session не создана' : 'не проверено';
    const api = state.api === true ? 'OK — st-api отвечает' : state.api === false ? 'ОШИБКА — st-api не пропускает запрос' : 'не проверено';
    let diagnosis = 'Нажмите Sign in ещё раз — диагностика появится здесь.';
    if (state.session === false) diagnosis = 'Вероятнее всего проблема на уровне Supabase Auth: email/пароль, подтверждение email или аккаунт Auth.';
    if (state.session === true && state.api === false) diagnosis = 'Supabase Auth принял учётные данные. Проблема дальше: st_users/st-api, активация аккаунта или несовместимость API.';
    if (state.session === true && state.api === true) diagnosis = 'Auth и st-api отвечают. Если вход всё ещё не проходит, проверяем профиль/роль и frontend build.';
    return '<details id="st-preview-auth-diagnostics" open style="margin-top:16px;border:1px solid #d8dee9;border-radius:12px;padding:12px;background:#f8fafc">' +
      '<summary style="cursor:pointer;font-weight:700">Диагностика входа (Preview)</summary>' +
      '<div style="margin-top:10px;display:grid;gap:7px;font-size:13px">' +
      '<div><b>Supabase Auth:</b> '+session+'</div>' +
      '<div><b>st-api:</b> '+api+'</div>' +
      '<div><b>Build:</b> '+esc(window.ST_BUILD)+'</div>' +
      '<div><b>Ошибка:</b> '+e+'</div>' +
      '<div style="margin-top:4px"><b>Вывод:</b> '+diagnosis+'</div>' +
      '</div></details>';
  }

  function render(){
    const box = document.querySelector('.login-box');
    if (!box) return;
    let panel = document.getElementById('st-preview-auth-diagnostics');
    if (panel) panel.outerHTML = panelHtml();
    else box.insertAdjacentHTML('beforeend', panelHtml());
  }

  async function inspect(){
    try {
      const client = window.ShineTimeSupabase?.client?.();
      if (!client) { state.session = false; state.api = false; render(); return; }
      const sessionResult = await client.auth.getSession();
      state.session = !!sessionResult?.data?.session;
      if (!state.session) { state.api = null; state.checkedAt = Date.now(); render(); return; }
      try {
        const result = await client.functions.invoke((window.ST_SUPABASE || {}).functionName || 'st-api', {
          body: { route:'/me', method:'GET', query:{}, body:{}, clientBuild:window.ST_BUILD || null }
        });
        state.api = !result?.error;
        if (result?.error) {
          try {
            const response = result.error.context;
            const detail = response ? await response.clone().json() : null;
            state.lastError = detail?.error || result.error.message || state.lastError;
          } catch (_) {}
        }
      } catch (apiError) {
        state.api = false;
        try {
          const response = apiError?.context;
          const detail = response ? await response.clone().json() : null;
          state.lastError = detail?.error || apiError?.message || state.lastError;
        } catch (_) {}
      }
      state.checkedAt = Date.now();
      render();
    } catch (error) {
      state.session = false;
      state.api = false;
      state.lastError = error?.message || state.lastError;
      state.checkedAt = Date.now();
      render();
    }
  }

  function install(){
    const api = window.ShineTimeSupabase;
    if (!api?.request || api.__previewAuthDiagnosticsInstalled) return;
    const original = api.request;
    api.request = async function(path, opts){
      try {
        const result = await original.call(this, path, opts);
        if (path === '/api/login') {
          state.lastError = null;
          state.session = true;
          state.api = true;
          render();
        }
        return result;
      } catch (error) {
        if (path === '/api/login' || path === '/api/me') {
          state.lastError = error?.message || 'Unknown error';
          render();
          setTimeout(inspect, 150);
        }
        throw error;
      }
    };
    api.__previewAuthDiagnosticsInstalled = true;
    render();
  }

  const timer = setInterval(() => {
    if (window.ShineTimeSupabase?.request) { clearInterval(timer); install(); }
  }, 25);
  setTimeout(() => { clearInterval(timer); install(); }, 5000);
  new MutationObserver(() => { if (document.querySelector('.login-box')) render(); }).observe(document.documentElement, {childList:true, subtree:true});
})();
