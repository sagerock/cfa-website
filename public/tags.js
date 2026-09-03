// Third-party measurement bootstrap (GA4 + Meta Pixel). Served first-party so the
// site's CSP can stay script-src 'self' + the two vendor hosts, with no
// 'unsafe-inline'. Loaded from src/components/ThirdPartyTags.astro on every page.
// Added 2026-08-26 on Sage's go. IDs: GA4 property 322148395 web stream "CfA";
// Meta "CFA Pixel" in ad account act_45601263.
(function () {
  var GA4_ID = 'G-M22HNR1PLT';
  var META_PIXEL_ID = '1802139657408971';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA4_ID, { send_page_view: true });

  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', META_PIXEL_ID);
  window.fbq('track', 'PageView');

  // One call for conversion events so pages don't need to know about both vendors.
  // kind: 'begin_checkout' | 'purchase' | 'lead'.
  // data: { value, currency, transaction_id, name, id }
  window.__cfaConversion = function (kind, data) {
    data = data || {};
    try {
      var value = data.value || 0, currency = data.currency || 'USD';
      if (kind === 'begin_checkout') {
        if (window.fbq) window.fbq('track', 'InitiateCheckout', { value: value, currency: currency,
          content_name: data.name, content_ids: data.id ? [data.id] : undefined, content_type: 'product' });
        if (window.gtag) gtag('event', 'begin_checkout', { value: value, currency: currency,
          items: [{ item_id: data.id, item_name: data.name, price: value, quantity: 1 }] });
      } else if (kind === 'purchase') {
        if (window.fbq) window.fbq('track', 'Purchase', { value: value, currency: currency,
          content_name: data.name, content_ids: data.id ? [data.id] : undefined, content_type: 'product' });
        if (window.gtag) gtag('event', 'purchase', { transaction_id: data.transaction_id, value: value, currency: currency,
          items: [{ item_id: data.id, item_name: data.name, price: value, quantity: 1 }] });
      } else if (kind === 'lead') {
        if (window.fbq) window.fbq('track', 'Lead', { content_name: data.name });
        if (window.gtag) gtag('event', 'generate_lead', { value: value, currency: currency });
      }
    } catch (e) {}
  };
})();
