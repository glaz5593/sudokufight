/** The admin site's server side (spec §27.3): its API under /admin/api and its files under /admin. */
export { createAdminRouter, type AdminRouterDeps } from './router';
export { createAdminSiteRouter, findAdminSiteDir, ADMIN_SITE_PATH } from './site';
export * from './constants';
