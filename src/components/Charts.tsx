import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts';
import { inr } from '../lib/format';

export const PALETTE = [
  '#4f46e5',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#64748b',
];

const axis = { fill: 'var(--muted)', fontSize: 11 };
const compact = (v: number) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const tip = {
  contentStyle: {
    background: 'var(--panel)',
    border: '1px solid var(--line)',
    borderRadius: 8,
    color: 'var(--text)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text)', fontWeight: 600 },
};

export interface Series {
  key: string;
  label: string;
  color?: string;
}

export function LineTrend({
  data,
  series,
  money = true,
}: {
  data: any[];
  series: Series[];
  money?: boolean;
}) {
  return (
    <div className="chart">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={axis}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            minTickGap={24}
          />
          <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={compact} width={52} />
          <Tooltip {...tip} formatter={(v: any) => (money ? inr(Number(v)) : v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Bars({
  data,
  series,
  money = true,
  horizontal = false,
  stacked = false,
  showValueLabels = false,
  xAxisTitle,
  yAxisTitle,
}: {
  data: any[];
  series: Series[];
  money?: boolean;
  horizontal?: boolean;
  stacked?: boolean;
  showValueLabels?: boolean;
  xAxisTitle?: string;
  yAxisTitle?: string;
}) {
  const h = horizontal ? Math.max(280, data.length * 36) : 280;
  return (
    <div className="chart" style={{ height: h }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 8, right: showValueLabels ? 75 : 12, bottom: xAxisTitle ? 16 : 0, left: horizontal ? 24 : 0 }}
        >
          <CartesianGrid stroke="var(--line)" horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                tick={axis}
                tickLine={false}
                axisLine={false}
                tickFormatter={money ? compact : undefined}
                label={xAxisTitle ? { value: xAxisTitle, position: 'insideBottom', offset: -5, fill: 'var(--muted)', fontSize: 11 } : undefined}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={axis}
                tickLine={false}
                axisLine={false}
                width={120}
                label={yAxisTitle ? { value: yAxisTitle, angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 11 } : undefined}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="name"
                tick={axis}
                tickLine={false}
                axisLine={{ stroke: 'var(--line)' }}
                interval={0}
                angle={data.length > 8 ? -30 : 0}
                textAnchor={data.length > 8 ? 'end' : 'middle'}
                height={data.length > 8 ? 60 : 30}
                label={xAxisTitle ? { value: xAxisTitle, position: 'insideBottom', offset: -5, fill: 'var(--muted)', fontSize: 11 } : undefined}
              />
              <YAxis
                tick={axis}
                tickLine={false}
                axisLine={false}
                tickFormatter={money ? compact : undefined}
                width={52}
                label={yAxisTitle ? { value: yAxisTitle, angle: -90, position: 'insideLeft', fill: 'var(--muted)', fontSize: 11 } : undefined}
              />
            </>
          )}
          <Tooltip
            {...tip}
            cursor={{ fill: 'var(--panel2)' }}
            formatter={(v: any) => (money ? inr(Number(v)) : v)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color ?? PALETTE[i % PALETTE.length]}
              radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
              stackId={stacked ? 'a' : undefined}
            >
              {showValueLabels && horizontal ? (
                <LabelList
                  dataKey={s.key}
                  position="right"
                  formatter={(v: any) => (money ? compact(Number(v)) : v)}
                  style={{ fill: 'var(--text)', fontSize: 11, fontWeight: 600 }}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({
  data,
  money = true,
}: {
  data: { name: string; value: number; formatted?: string }[];
  money?: boolean;
}) {
  const rows = data.filter((d) => d.value > 0);
  if (!rows.length) return <div className="empty">No data for this selection.</div>;
  const total = rows.reduce((acc, r) => acc + r.value, 0);

  return (
    <div className="chart">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="var(--panel)"
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            {...tip}
            formatter={(v: any) => {
              const val = Number(v);
              const p = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
              return [`${money ? inr(val) : val} (${p}%)`, 'Amount'];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value, entry: any) => {
              const val = Number(entry.payload?.value ?? 0);
              const p = total > 0 ? ((val / total) * 100).toFixed(0) : '0';
              return `${value}: ${money ? inr(val) : val} (${p}%)`;
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
