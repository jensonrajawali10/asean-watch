// PLACEHOLDER: owned by the UI shell agent.
import { loadFixtures } from './lib/fixtures';
import RegionMap from './components/RegionMap';

const fixtures = loadFixtures();

export default function App() {
  return (
    <main>
      <h1>ASEAN Watch</h1>
      <RegionMap incidents={fixtures.incidents} selectedId={null} states={{}} onSelect={() => {}} />
    </main>
  );
}
