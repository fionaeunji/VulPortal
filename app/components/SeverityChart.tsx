"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Datum {
  label: string;
  open: number;
  done: number;
  total: number;
}

/** 위험도별 색 (상태 색: 긴급=critical, 우선=serious, 주의=warning). 라벨과 함께 써서 색만으로 뜻을 전달하지 않습니다. */
const COLORS = ["#d03b3b", "#ec835a", "#fab219"];

/** 위험도별 취약점 분포 막대 차트 (미조치 건수 기준, 전체 건수는 툴팁에 표시) */
export default function SeverityChart({ data }: { data: Datum[] }) {
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 40, bottom: 8, left: 8 }} barSize={22}>
          <CartesianGrid horizontal={false} stroke="#e5e7eb" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={48} tick={{ fontSize: 13, fill: "#1f2937" }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "#f3f4f6" }}
            formatter={(value, _name, item) => {
              const d = item.payload as Datum;
              return [`미조치 ${Number(value).toLocaleString()}건 / 완료 ${d.done.toLocaleString()}건 / 전체 ${d.total.toLocaleString()}건`, d.label];
            }}
          />
          <Bar dataKey="open" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={COLORS.at(i) ?? "#6b7280"} />
            ))}
            <LabelList dataKey="open" position="right" style={{ fontSize: 12, fill: "#1f2937" }} formatter={(v: unknown) => `${Number(v).toLocaleString()}건`} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
