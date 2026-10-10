import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';
import { rampPreset, rampSpeed } from '../core/speed';
import type { SpeedRamp } from '../core/speed';

export function SpeedRampEditor({
  points,
  onChange,
  readOnly,
}: {
  points: SpeedRamp | undefined;
  onChange: (points: SpeedRamp | undefined) => void;
  readOnly?: boolean;
}) {
  const patch = (i: number, value: Partial<SpeedRamp[number]>) =>
    onChange(points!.map((p, index) => (index === i ? { ...p, ...value } : p)));
  return (
    <div className="grid gap-3">
      <Label htmlFor="speed-profile">Speed profile</Label>
      <SettingsSelect
        id="speed-profile"
        selectedLabel={points ? 'Custom ramp' : 'Constant'}
        label="Speed profile"
        value={points ? 'custom' : 'constant'}
        disabled={readOnly}
        onChange={(value) => {
          if (value === 'constant') onChange(undefined);
          else if (value === 'custom' && !points)
            onChange([
              { position: 0, speed: 1, interpolation: 'linear' },
              { position: 1, speed: 1, interpolation: 'linear' },
            ]);
          else if (value.startsWith('steps-')) {
            const direction = value.slice(6);
            if (
              direction === 'up' ||
              direction === 'down' ||
              direction === 'up-down' ||
              direction === 'down-up'
            )
              onChange(rampPreset(direction, 'hold'));
          } else if (
            value === 'up' ||
            value === 'down' ||
            value === 'up-down' ||
            value === 'down-up'
          )
            onChange(rampPreset(value));
        }}
        options={[
          { value: 'constant', label: 'Constant' },
          { value: 'custom', label: 'Custom ramp' },
          { value: 'up', label: 'Ramp up' },
          { value: 'down', label: 'Ramp down' },
          { value: 'up-down', label: 'Up then down' },
          { value: 'down-up', label: 'Down then up' },
          { value: 'steps-up', label: 'Staircase up' },
          { value: 'steps-down', label: 'Staircase down' },
          { value: 'steps-up-down', label: 'Staircase up then down' },
          { value: 'steps-down-up', label: 'Staircase down then up' },
        ]}
      />
      {points && (
        <>
          <svg
            viewBox="0 0 320 100"
            className="h-24 w-full rounded-md border bg-muted/30"
            role="img"
            aria-label="Speed ramp graph"
          >
            <path
              d={Array.from(
                { length: 161 },
                (_, i) =>
                  `${i ? 'L' : 'M'} ${10 + (i * 300) / 160} ${90 - ((rampSpeed(points, i / 160) - 0.25) * 80) / 3.75}`,
              ).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            {points.map((point, i) => (
              <circle
                key={i}
                cx={10 + point.position * 300}
                cy={90 - ((point.speed - 0.25) * 80) / 3.75}
                r="3"
                fill="currentColor"
              />
            ))}
          </svg>
          {points.map((point, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_1.4fr] items-end gap-2"
            >
              <div className="grid gap-1">
                <Label htmlFor={`ramp-position-${i}`}>Point {i + 1} (%)</Label>
                <Input
                  id={`ramp-position-${i}`}
                  type="number"
                  required
                  min={i ? points[i - 1]!.position * 100 + 0.01 : 0}
                  max={
                    i < points.length - 1
                      ? points[i + 1]!.position * 100 - 0.01
                      : 100
                  }
                  step="any"
                  readOnly={readOnly || i === 0 || i === points.length - 1}
                  value={point.position * 100}
                  onChange={(e) =>
                    patch(i, { position: Number(e.target.value) / 100 })
                  }
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`ramp-speed-${i}`}>Point {i + 1} speed</Label>
                <Input
                  id={`ramp-speed-${i}`}
                  type="number"
                  required
                  min={0.25}
                  max={4}
                  step="any"
                  readOnly={readOnly}
                  value={point.speed}
                  onChange={(e) => patch(i, { speed: Number(e.target.value) })}
                />
              </div>
              {i < points.length - 1 ? (
                <SettingsSelect
                  selectedLabel={
                    point.interpolation === 'smooth'
                      ? 'Curve'
                      : point.interpolation === 'hold'
                        ? 'Staircase'
                        : 'Linear'
                  }
                  label={`Segment ${i + 1}`}
                  value={point.interpolation}
                  disabled={readOnly}
                  onChange={(value) =>
                    patch(i, {
                      interpolation: value as 'smooth' | 'linear' | 'hold',
                      curveStart: undefined,
                      curveEnd: undefined,
                    })
                  }
                  options={[
                    { value: 'smooth', label: 'Curve' },
                    { value: 'linear', label: 'Linear' },
                    { value: 'hold', label: 'Staircase' },
                  ]}
                />
              ) : (
                <span />
              )}
              {!readOnly && i > 0 && i < points.length - 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="col-span-3 justify-self-end"
                  onClick={() =>
                    onChange(points.filter((_, index) => index !== i))
                  }
                >
                  Remove point {i + 1}
                </Button>
              )}
            </div>
          ))}
          {!readOnly && points.length < 64 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                let index = 0;
                for (let i = 1; i < points.length - 1; i++)
                  if (
                    points[i + 1]!.position - points[i]!.position >
                    points[index + 1]!.position - points[index]!.position
                  )
                    index = i;
                const position =
                  (points[index]!.position + points[index + 1]!.position) / 2;
                onChange([
                  ...points.slice(0, index + 1),
                  {
                    position,
                    speed: rampSpeed(points, position),
                    interpolation: points[index]!.interpolation,
                  },
                  ...points.slice(index + 1),
                ]);
              }}
            >
              Add ramp point
            </Button>
          )}
        </>
      )}
    </div>
  );
}
