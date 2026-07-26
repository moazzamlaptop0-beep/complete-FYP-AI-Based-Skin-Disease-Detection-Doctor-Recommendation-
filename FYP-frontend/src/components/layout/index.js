/**
 * Barrel for the new application chrome.
 *
 * NOTE: `Navbar` and `Footer` (the pre-refactor components still mounted by
 * App.jsx) are deliberately NOT re-exported here. They keep working untouched
 * this phase and are imported by their own paths; mixing them into this barrel
 * would make it impossible to see, at a glance, which pages have been migrated.
 */

export { default as AppNavbar, Brand } from './AppNavbar';
export { default as AppShell } from './AppShell';
export { default as DashboardLayout } from './DashboardLayout';
export { default as LanguageToggle } from './LanguageToggle';
export { LANGUAGES, applyLanguage, storedLanguage } from './language';
export { default as MobileDrawer } from './MobileDrawer';
export { default as MobileTabBar } from './MobileTabBar';
export { default as NotificationBell } from './NotificationBell';
export { deriveNotifications } from './notifications';
export { default as ProfileMenu } from './ProfileMenu';
export { default as QuickScanButton, QUICK_SCAN_ROUTE } from './QuickScanButton';
export { default as ThemeToggle } from './ThemeToggle';
export { default as ViewAsBanner } from './ViewAsBanner';
export { default as WorkspaceSwitcher } from './WorkspaceSwitcher';
export { activeWorkspace } from './workspaces';

export {
  PRIMARY_NAV,
  PROFILE_MENU_ITEMS,
  TAB_BAR_NAV,
  WORKSPACE_NAV,
  visibleNav,
  visibleSections,
} from './navigation';
export { default as useMenu } from './useMenu';
