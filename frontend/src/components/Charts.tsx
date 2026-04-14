import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  type PieLabelRenderProps,
} from "recharts";
import type { PiiSignal, FileTypeCount, LargestFile, DepthCount } from "@/lib/api";
import { formatSize } from "@/lib/utils";

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
];

const tooltipStyle = {
  backgroundColor: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  color: "var(--color-card-foreground)",
};

/* ------------------------------------------------------------------ */
/*  File Type Distribution (donut)                                     */
/* ------------------------------------------------------------------ */

interface FileTypeChartProps {
  data: FileTypeCount[];
  onSegmentClick?: (ext: string) => void;
}

export function FileTypeChart({ data, onSegmentClick }: FileTypeChartProps) {
  if (!data || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No files to chart.
      </p>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            style={onSegmentClick ? { cursor: "pointer" } : undefined}
            onClick={
              onSegmentClick
                ? (_, index) => {
                    const ext = data[index]?.name;
                    if (ext) onSegmentClick(ext);
                  }
                : undefined
            }
            label={(props: PieLabelRenderProps) => {
              const name = String(props.name ?? "");
              const percent = Number(props.percent ?? 0);
              return `${name} ${(percent * 100).toFixed(0)}%`;
            }}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      {onSegmentClick && (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Click a segment to view files
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PII Categories by Score (horizontal bar)                           */
/* ------------------------------------------------------------------ */

interface PiiCategoryChartProps {
  signals: PiiSignal[];
}

export function PiiCategoryChart({ signals }: PiiCategoryChartProps) {
  const catMap: Record<string, { count: number; score: number }> = {};
  signals.forEach((s) => {
    if (!catMap[s.category]) catMap[s.category] = { count: 0, score: 0 };
    catMap[s.category].count += 1;
    catMap[s.category].score += s.score;
  });

  const data = Object.entries(catMap)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10)
    .map(([name, val]) => ({
      name: name.length > 20 ? name.slice(0, 18) + "..." : name,
      fullName: name,
      score: val.score,
      count: val.count,
    }));

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No PII categories detected.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
        <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(...args: unknown[]) => {
            const value = args[0];
            const p = args[2] as { payload?: { fullName?: string; count?: number } } | undefined;
            return [
              `Score: ${value} (${p?.payload?.count ?? 0} matches)`,
              p?.payload?.fullName ?? "",
            ];
          }}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  File Size by Extension (horizontal bar)                            */
/* ------------------------------------------------------------------ */

interface FileSizeByTypeChartProps {
  data: FileTypeCount[];
  onBarClick?: (ext: string) => void;
}

export function FileSizeByTypeChart({ data, onBarClick }: FileSizeByTypeChartProps) {
  if (!data || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No file size data available.
      </p>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickFormatter={(v: number) => formatSize(v)}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={60}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(...args: unknown[]) => {
              const value = args[0] as number;
              return [formatSize(value), "Total Size"];
            }}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            style={onBarClick ? { cursor: "pointer" } : undefined}
            onClick={
              onBarClick
                ? (entry) => {
                    const ext = (entry as { name?: string })?.name;
                    if (ext) onBarClick(ext);
                  }
                : undefined
            }
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {onBarClick && (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Click a bar to view files
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Top Largest Files (horizontal bar)                                 */
/* ------------------------------------------------------------------ */

interface TopLargestFilesChartProps {
  data: LargestFile[];
}

export function TopLargestFilesChart({ data }: TopLargestFilesChartProps) {
  if (!data || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No files to display.
      </p>
    );
  }

  const chartData = data.map((f) => ({
    name: f.name.length > 25 ? f.name.slice(0, 23) + "..." : f.name,
    fullName: f.name,
    path: f.path,
    value: f.size,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          tickFormatter={(v: number) => formatSize(v)}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(...args: unknown[]) => {
            const value = args[0] as number;
            const p = args[2] as { payload?: { path?: string } } | undefined;
            return [
              `${formatSize(value)}`,
              p?.payload?.path ?? "",
            ];
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Depth Distribution (area chart)                                    */
/* ------------------------------------------------------------------ */

interface DepthDistributionChartProps {
  data: DepthCount[];
}

export function DepthDistributionChart({ data }: DepthDistributionChartProps) {
  if (!data || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No depth data available.
      </p>
    );
  }

  const chartData = data.map((d) => ({
    name: `Level ${d.depth}`,
    depth: d.depth,
    count: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={chartData} margin={{ left: 0, right: 10 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(...args: unknown[]) => {
            const value = args[0] as number;
            return [`${value} nodes`, "Count"];
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="var(--color-chart-1)"
          fill="var(--color-chart-1)"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
