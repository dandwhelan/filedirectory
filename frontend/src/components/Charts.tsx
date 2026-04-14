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
  type PieLabelRenderProps,
} from "recharts";
import type { PiiSignal, FileTypeCount } from "@/lib/api";

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

interface FileTypeChartProps {
  data: FileTypeCount[];
}

export function FileTypeChart({ data }: FileTypeChartProps) {
  if (!data || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No files to chart.
      </p>
    );
  }

  return (
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
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            color: "var(--color-card-foreground)",
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

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
          contentStyle={{
            backgroundColor: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            color: "var(--color-card-foreground)",
          }}
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
