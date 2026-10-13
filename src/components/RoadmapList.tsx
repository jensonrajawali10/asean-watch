// Later modules, collapsed by default and listed as plain text. Not navigation: none are built.
const MODULES = ['Wildfire and haze', 'Flooding', 'Deforestation', 'Marine pollution'];

export default function RoadmapList() {
  return (
    <details className="roadmap">
      <summary>Roadmap (not built)</summary>
      <p className="roadmap-body">Later modules on the same evidence model: {MODULES.join(' · ')}.</p>
    </details>
  );
}
