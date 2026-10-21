import React from 'react';
// Stands in for the providers a product's app shell supplies (i18n, theme, tooltips, router or panel contexts).
// Mirror only what the on-screen components read, with fixed values. `dark` adds the product's dark-theme class.
export function ProductContext({children, dark = false, className = ''}) {
  const classes = ['product-root', dark && 'dark', className].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
