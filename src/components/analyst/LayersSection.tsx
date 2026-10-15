// Layers section of the analyst workspace (docs/UX_V3.md section 3.9): every map layer, grouped, with a
// one-line explanation and its data kind. The six map chips are the same toggles; everything else lives
// only here. App owns the state (src/components/map/layerCatalog.ts is the one list).
import { LAYER_GROUPS, LAYER_KIND_LABEL, layersInGroup } from '../map/layerCatalog';
import type { LayerDef, MapLayerState } from '../map/layerCatalog';
import { AnalystSection, AnalystSubhead } from './AnalystSection';

export interface LayersSectionProps {
  layers: MapLayerState;
  onLayersChange: (patch: Partial<MapLayerState>) => void;
  /** Layers that have nothing to draw right now (e.g. ash drift with no volcano selected), with the reason. */
  unavailable?: Partial<Record<LayerDef['key'], string>>;
}

export default function LayersSection({ layers, onLayersChange, unavailable = {} }: LayersSectionProps) {
  const on = (key: LayerDef['key']) => layers[key];
  const set = (key: LayerDef['key'], value: boolean) => onLayersChange({ [key]: value } as Partial<MapLayerState>);
  return (
    <AnalystSection
      id="layers"
      title="Layers"
      lede="Everything the map can draw. The six chips above the scrubber are the first six here; the rest are analyst layers. Each label says whether the layer is measured, modelled, official or imagery, because those are never the same thing."
    >
      {LAYER_GROUPS.map((group) => (
        <div key={group}>
          <AnalystSubhead>{group}</AnalystSubhead>
          {layersInGroup(group).map((def) => {
            const why = unavailable[def.key];
            return (
              <div key={def.key}>
                <label className="ws-layer">
                  <input type="checkbox" checked={on(def.key)} onChange={(e) => set(def.key, e.currentTarget.checked)} />
                  <span className="ws-layer__label">
                    {def.label}
                    <span className="an-tag">{LAYER_KIND_LABEL[def.kind]}</span>
                    {def.chip && <span className="an-tag">map chip</span>}
                  </span>
                  <span className="ws-layer__exp">
                    {def.explanation}
                    {why ? ` ${why}` : ''}
                  </span>
                  {(def.key === 'satIr' || def.key === 'satTrue') && on(def.key) && (
                    <span className="ws-layer__range">
                      Imagery opacity
                      <input
                        type="range"
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={layers.satOpacity}
                        onChange={(e) => onLayersChange({ satOpacity: Number(e.currentTarget.value) })}
                        aria-label="Satellite imagery opacity"
                        aria-valuetext={`${Math.round(layers.satOpacity * 100)} %`}
                      />
                      {Math.round(layers.satOpacity * 100)} %
                    </span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      ))}
    </AnalystSection>
  );
}
