// ==UserScript==
// @name         MapMagic Anti-paywall
// @version      1.0.0
// @author       waseeen
// @match        https://mapmagic.app/*
// @run-at       document-start
// @grant        none
// @description  Subscription activation
// @source       https://github.com/waseeen/MapMagicAntiPaywall/raw/master/mmap.user.js
// ==/UserScript==

(() => {
  'use strict';

  const FAR_FUTURE = '2099-12-31T23:59:59.000Z';
  const enabledForUrl = (url) => {
    const text = String(url || '');
    return (
      /\/api\/[^/]+\/user(?:[/?#]|$)/i.test(text) ||
      /\/api\/[^/]+\/user\/profileInfo(?:[/?#]|$)/i.test(text) ||
      /\/api\/[^/]+\/User\/FreeLimitsInfo(?:[/?#]|$)/.test(text)
    );
  };

  const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

  const patchUserLikeObject = (object) => {
    const looksLikeUser =
      'id_user' in object ||
      'userId' in object ||
      'premium' in object ||
      ('email' in object && 'subscription_level' in object);

    if (looksLikeUser) {
      object.premium = true;
      object.subscription_level = 'ULTRA';
      object.premium_expired = FAR_FUTURE;
      object.trial_expired = FAR_FUTURE;
      object.trial_used = false;
      object.download_tracks_count = 0;
      object.garmin_courses_permitted = true;
      object.limits = {
        ...(isPlainObject(object.limits) ? object.limits : {}),
        days_to_period_end: 9999,
        downloads_at_period: 0,
      };
    }

    if ('days_to_period_end' in object || 'downloads_at_period' in object) {
      object.days_to_period_end = 9999;
      object.downloads_at_period = 0;
    }
  };

  const patchJson = (value, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) patchJson(item, seen);
      return value;
    }

    patchUserLikeObject(value);
    for (const key of Object.keys(value)) patchJson(value[key], seen);
    return value;
  };

  const tryPatchText = (text, url) => {
    if (!enabledForUrl(url)) return text;
    try {
      return JSON.stringify(patchJson(JSON.parse(text)));
    } catch {
      return text;
    }
  };

  const patchJsonParse = () => {
    const originalParse = JSON.parse;

    JSON.parse = function patchedJsonParse(text, reviver) {
      const value = originalParse.apply(this, arguments);
      if (typeof text !== 'string') return value;
      if (
        text.includes('subscription_level') ||
        text.includes('"premium"') ||
        text.includes('downloads_at_period') ||
        text.includes('days_to_period_end')
      ) {
        return patchJson(value);
      }
      return value;
    };
  };

  const patchFetch = () => {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;

    window.fetch = async function patchedFetch(input, init) {
      const response = await originalFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : input && input.url;
      if (!enabledForUrl(url)) return response;

      try {
        const text = await response.clone().text();
        const patchedText = tryPatchText(text, url);
        if (patchedText === text) return response;
        return new Response(patchedText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return response;
      }
    };
  };

  const patchXhr = () => {
    if (typeof window.XMLHttpRequest !== 'function') return;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__mapmagicLocalUltraUrl = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4 || !enabledForUrl(this.__mapmagicLocalUltraUrl)) return;

        const originalText = this.responseText;
        const patchedText = tryPatchText(originalText, this.__mapmagicLocalUltraUrl);
        if (patchedText === originalText) return;

        Object.defineProperty(this, 'responseText', {
          configurable: true,
          get: () => patchedText,
        });
        Object.defineProperty(this, 'response', {
          configurable: true,
          get: () => {
            if (this.responseType === '' || this.responseType === 'text') return patchedText;
            if (this.responseType === 'json') return JSON.parse(patchedText);
            return patchedText;
          },
        });
      });

      return originalSend.apply(this, arguments);
    };
  };

  patchJsonParse();
  patchFetch();
  patchXhr();
})();
