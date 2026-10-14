export const ANALYTICS_MEASUREMENT_ID = 'G-KDQH39FXV3';

export function loadAnalytics(document, window) {
  if (document.querySelector('script[data-simplex-analytics]')) {
    return false;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_MEASUREMENT_ID}`;

  if (script.dataset) {
    script.dataset.simplexAnalytics = '';
  } else {
    script.setAttribute('data-simplex-analytics', '');
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', ANALYTICS_MEASUREMENT_ID);
  document.head.append(script);

  return true;
}
