// Inline SVG icons for the taskbar and the map cards. Simple 1.6 px strokes on a 20 px grid, currentColor,
// decorative (aria-hidden); the button or heading next to them carries the text.
import type { ReactElement } from 'react';
import type { SectionId } from './workspace';

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 20, className, children }: IconProps & { children: ReactElement | ReactElement[] }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const MapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 5.5 7 3.5l6 2 4.5-2v11l-4.5 2-6-2-4.5 2z" />
    <path d="M7 3.5v11M13 5.5v11" />
  </Svg>
);

export const SituationIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="2.5" width="13" height="15" rx="1.5" />
    <path d="M6.5 6.5h7M6.5 9.5h7M6.5 12.5h4" />
  </Svg>
);

export const HazeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 14.5h8.5a3 3 0 0 0 .4-5.97A4.5 4.5 0 0 0 6.3 7.6 3.5 3.5 0 0 0 6 14.5z" />
    <path d="M3 17h11" />
  </Svg>
);

export const FireIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 2.5c.6 3 4 4.6 4 9a4.5 4.5 0 0 1-9 0c0-2.4 1.3-3.9 2.3-5 .2 1.8 1 2.9 1.9 3.2-.6-2.5-.2-5 .8-7.2z" />
  </Svg>
);

export const VolcanoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 17 7.5 7.5h5L17.5 17z" />
    <path d="M8.5 4.5V2.8M10 5V2M11.5 4.5V2.8" />
  </Svg>
);

export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3 17.5 16h-15z" />
    <path d="M10 8v4" />
    <circle cx="10" cy="14" r="0.6" fill="currentColor" />
  </Svg>
);

export const WaterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 7.5q2.5-2.5 5 0t5 0 5 0" />
    <path d="M2.5 12.5q2.5-2.5 5 0t5 0 5 0" />
  </Svg>
);

export const ReportIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 2.5h7l3.5 3.5v11.5h-10.5z" />
    <path d="M12 2.5V6h3.5" />
    <path d="M10 8.5v6M7.8 12.3 10 14.5l2.2-2.2" />
  </Svg>
);

export const SourcesIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="10" cy="5" rx="6.5" ry="2.5" />
    <path d="M3.5 5v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V5" />
    <path d="M3.5 10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m10 3 7.5 4L10 11 2.5 7z" />
    <path d="m2.5 11 7.5 4 7.5-4M2.5 14.5 10 18.5l7.5-4" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Svg>
);

export const CityIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const SECTION_ICONS: Record<SectionId, (p: IconProps) => ReactElement> = {
  situation: SituationIcon,
  haze: HazeIcon,
  fires: FireIcon,
  volcanoes: VolcanoIcon,
  warnings: WarningIcon,
  water: WaterIcon,
  report: ReportIcon,
  sources: SourcesIcon,
  layers: LayersIcon,
};
