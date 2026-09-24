// The boutique and the bar, in one place for app/boot.ts: the two screens, the bar's orders, the
// HUD buttons, the showroom, and the HTTP calls.

export { openShop, type ShopApi, type ShopDeps } from './boutique.ts';
export { openBarMenu, type BarMenuDeps } from './barmenu.ts';
export { Bar, DELIVERY_MS, applyMoney, type BarDeps } from './bar.ts';
export { shopButton, shopIcon, type ShopIconName } from './icons.ts';
export { Showroom, framingFor, type Framing } from './showroom.ts';
export * as shopApi from './api.ts';
