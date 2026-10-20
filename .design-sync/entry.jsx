// design-sync bundle entry. The frontend is an app, not a library (no dist/, no .d.ts), so this
// barrel is the export list the Claude Design bundle is built from. Add a line here when a new
// reusable piece should reach the design system; keep App/main out (they are the shell, not parts).
export { default as AuthGate } from '../frontend/src/components/AuthGate.jsx';
export { default as Home } from '../frontend/src/views/Home.jsx';
export { default as Ask } from '../frontend/src/views/Ask.jsx';
export { default as CompareDpias } from '../frontend/src/views/CompareDpias.jsx';
export { default as ComplianceConfig } from '../frontend/src/views/ComplianceConfig.jsx';
export { default as Connections } from '../frontend/src/views/Connections.jsx';
export { default as DependencyNotifier } from '../frontend/src/views/DependencyNotifier.jsx';
export { default as DmsDocuments } from '../frontend/src/views/DmsDocuments.jsx';
export { default as DraftRisk } from '../frontend/src/views/DraftRisk.jsx';
export { default as FollowUps } from '../frontend/src/views/FollowUps.jsx';
export { default as GuidelinesView, GuidelinesLegend } from '../frontend/src/views/GuidelinesView.jsx';
export { default as RiskRegister } from '../frontend/src/views/RiskRegister.jsx';
export * from '../frontend/src/lib/icons.jsx';
