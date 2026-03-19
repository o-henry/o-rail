import type { FeedChartSpec } from "../../features/feed/chartSpec";

const CHART_COLORS = ["#4A7BFF", "#37B679", "#F08B2D", "#A56CFF", "#16A3A3", "#E2557E"];

type FeedChartProps = {
  spec: FeedChartSpec;
};

function getSeriesColor(input: string | undefined, index: number): string {
  if (input && input.trim()) {
    return input;
  }
  return CHART_COLORS[index % CHART_COLORS.length];
}

function describeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString();
  }
  return String(Math.round(value * 100) / 100);
}

function renderBarChart(spec: FeedChartSpec) {
  const width = 700;
  const height = 280;
  const padding = { top: 24, right: 20, bottom: 40, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...spec.series.flatMap((series) => series.data));
  const groupCount = spec.labels.length;
  const seriesCount = spec.series.length;
  const groupWidth = chartWidth / Math.max(1, groupCount);
  const barWidth = Math.max(6, (groupWidth * 0.74) / Math.max(1, seriesCount));

  return (
    <svg className="feed-chart-svg" viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
      <line x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + chartHeight} />
      <line
        x1={padding.left}
        x2={padding.left + chartWidth}
        y1={padding.top + chartHeight}
        y2={padding.top + chartHeight}
      />
      {spec.labels.map((label, labelIndex) => (
        <text
          className="feed-chart-axis-label"
          key={`label-${labelIndex}`}
          textAnchor="middle"
          x={padding.left + groupWidth * labelIndex + groupWidth / 2}
          y={padding.top + chartHeight + 20}
        >
          {label}
        </text>
      ))}
      {spec.series.map((series, seriesIndex) =>
        series.data.map((value, valueIndex) => {
          const scaled = (Math.max(0, value) / maxValue) * chartHeight;
          const x =
            padding.left + valueIndex * groupWidth + (groupWidth - barWidth * seriesCount) / 2 + seriesIndex * barWidth;
          const y = padding.top + chartHeight - scaled;
          const color = getSeriesColor(series.color, seriesIndex);
          return (
            <g key={`bar-${seriesIndex}-${valueIndex}`}>
              <rect className="feed-chart-bar" fill={color} height={scaled} rx={2} width={barWidth - 1} x={x} y={y} />
              <text className="feed-chart-value-label" textAnchor="middle" x={x + (barWidth - 1) / 2} y={Math.max(12, y - 6)}>
                {describeNumber(value)}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}

function renderLineChart(spec: FeedChartSpec) {
  const width = 700;
  const height = 280;
  const padding = { top: 24, right: 20, bottom: 40, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...spec.series.flatMap((series) => series.data));
  const stepX = chartWidth / Math.max(1, spec.labels.length - 1);

  return (
    <svg className="feed-chart-svg" viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
      <line x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + chartHeight} />
      <line
        x1={padding.left}
        x2={padding.left + chartWidth}
        y1={padding.top + chartHeight}
        y2={padding.top + chartHeight}
      />
      {spec.labels.map((label, labelIndex) => (
        <text
          className="feed-chart-axis-label"
          key={`label-${labelIndex}`}
          textAnchor="middle"
          x={padding.left + stepX * labelIndex}
          y={padding.top + chartHeight + 20}
        >
          {label}
        </text>
      ))}
      {spec.series.map((series, seriesIndex) => {
        const color = getSeriesColor(series.color, seriesIndex);
        const points = series.data
          .map((value, valueIndex) => {
            const x = padding.left + stepX * valueIndex;
            const y = padding.top + chartHeight - (Math.max(0, value) / maxValue) * chartHeight;
            return { x, y, value };
          })
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");

        return (
          <g key={`line-series-${seriesIndex}`}>
            <polyline className="feed-chart-line" fill="none" points={polyline} stroke={color} />
            {points.map((point, pointIndex) => (
              <g key={`line-point-${seriesIndex}-${pointIndex}`}>
                <circle className="feed-chart-dot" cx={point.x} cy={point.y} fill={color} r={3.5} />
                <text className="feed-chart-value-label" textAnchor="middle" x={point.x} y={Math.max(12, point.y - 7)}>
                  {describeNumber(point.value)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const startX = cx + Math.cos(startAngle) * radius;
  const startY = cy + Math.sin(startAngle) * radius;
  const endX = cx + Math.cos(endAngle) * radius;
  const endY = cy + Math.sin(endAngle) * radius;
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;
}

function renderPieChart(spec: FeedChartSpec) {
  const width = 520;
  const height = 240;
  const cx = 128;
  const cy = 120;
  const radius = 74;
  const values = spec.series[0]?.data.slice(0, spec.labels.length) ?? [];
  const total = Math.max(1, values.reduce((sum, value) => sum + Math.max(0, value), 0));
  let angle = -Math.PI / 2;

  return (
    <svg className="feed-chart-svg" viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
      {values.map((value, index) => {
        const ratio = Math.max(0, value) / total;
        const nextAngle = angle + ratio * Math.PI * 2;
        const color = getSeriesColor(spec.series[0]?.color, index);
        const path = arcPath(cx, cy, radius, angle, nextAngle);
        const mid = (angle + nextAngle) / 2;
        const labelX = cx + Math.cos(mid) * (radius + 18);
        const labelY = cy + Math.sin(mid) * (radius + 18);
        angle = nextAngle;
        return (
          <g key={`pie-${index}`}>
            <path className="feed-chart-pie-slice" d={path} fill={color} />
            <text className="feed-chart-axis-label" textAnchor="middle" x={labelX} y={labelY}>
              {Math.round(ratio * 100)}%
            </text>
          </g>
        );
      })}
      <g className="feed-chart-legend">
        {spec.labels.map((label, index) => (
          <g key={`legend-${index}`} transform={`translate(248, ${48 + index * 20})`}>
            <rect fill={getSeriesColor(spec.series[0]?.color, index)} height={10} rx={2} width={10} x={0} y={-8} />
            <text className="feed-chart-axis-label" x={16} y={0}>
              {label} ({describeNumber(values[index] ?? 0)})
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export default function FeedChart({ spec }: FeedChartProps) {
  return (
    <section className="feed-chart-card">
      {spec.title && <div className="feed-chart-title">{spec.title}</div>}
      {spec.type === "pie" ? renderPieChart(spec) : spec.type === "line" ? renderLineChart(spec) : renderBarChart(spec)}
    </section>
  );
}
