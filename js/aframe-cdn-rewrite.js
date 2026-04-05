/**
 * A-Frame 1.3.0 hard-codes https://cdn.aframe.io/… for controller models (and does not read
 * window.AFRAME_CDN_ROOT). Rewrite those URLs to the same path under window.AFRAME_CDN_ROOT so
 * requests stay same-origin when assets are mirrored under libs/aframe-cdn/.
 */
(function () {
  var PREFIX = 'https://cdn.aframe.io/';
  var base = function () {
    var r = window.AFRAME_CDN_ROOT;
    if (typeof r !== 'string' || !r) {
      r = new URL('libs/aframe-cdn/', document.baseURI).href;
      window.AFRAME_CDN_ROOT = r;
    }
    return r.endsWith('/') ? r : r + '/';
  };
  function rewrite(url) {
    if (typeof url !== 'string' || url.indexOf(PREFIX) !== 0) return url;
    try {
      return new URL(url.slice(PREFIX.length), base()).href;
    } catch (e) {
      return url;
    }
  }

  var xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var a = arguments;
    a[1] = rewrite(url);
    return xo.apply(this, a);
  };

  if (typeof window.fetch === 'function') {
    var of = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === 'string') {
        input = rewrite(input);
      } else if (input && typeof Request !== 'undefined' && input instanceof Request) {
        var u = rewrite(input.url);
        if (u !== input.url) {
          input = new Request(u, input);
        }
      }
      return of.call(this, input, init);
    };
  }

  var sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (
      name === 'src' &&
      this.tagName === 'IMG' &&
      typeof value === 'string'
    ) {
      value = rewrite(value);
    }
    return sa.call(this, name, value);
  };
})();
