"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const tip = { border: "1px solid #e3e8ee", borderRadius: 10, fontSize: 12 };

export function SpendChart({ data }: { data: Array<{ month: string; spend: number; estimated: number }> }) {
  if (!data.length) return <EmptyChart label="Awarded purchases will draw this comparison." />;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#e6ebf1" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#5e6d7e" }} />
          <YAxis tick={{ fontSize: 12, fill: "#5e6d7e" }} />
          <Tooltip contentStyle={tip} />
          <Legend />
          <Line type="monotone" dataKey="estimated" name="Estimated" stroke="#8aa0b8" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="spend" name="Actual" stroke="#1f7a4d" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart({ data }: { data: Array<{ category: string; savings: number }> }) {
  if (!data.length) return <EmptyChart label="Savings by category appear after awarded deals." />;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#e6ebf1" vertical={false} />
          <XAxis dataKey="category" tick={{ fontSize: 12, fill: "#5e6d7e" }} />
          <YAxis tick={{ fontSize: 12, fill: "#5e6d7e" }} />
          <Tooltip contentStyle={tip} />
          <Bar dataKey="savings" name="Savings" fill="#1a3d66" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceChart({ data }: { data: Array<{ name: string; score: number; onTime: number }> }) {
  if (!data.length) return <EmptyChart label="Supplier scores appear after records are added." />;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#e6ebf1" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5e6d7e" }} interval={0} />
          <YAxis tick={{ fontSize: 12, fill: "#5e6d7e" }} />
          <Tooltip contentStyle={tip} />
          <Legend />
          <Bar dataKey="score" name="Score" fill="#10233b" radius={[6, 6, 0, 0]} />
          <Bar dataKey="onTime" name="On time %" fill="#1f7a4d" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ParticipationChart({ data }: { data: Array<{ name: string; invited: number; responded: number }> }) {
  if (!data.length) return <EmptyChart label="Invitation activity will appear here." />;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#e6ebf1" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5e6d7e" }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#5e6d7e" }} />
          <Tooltip contentStyle={tip} />
          <Legend />
          <Bar dataKey="invited" name="Invited" fill="#8aa0b8" radius={[6, 6, 0, 0]} />
          <Bar dataKey="responded" name="Responded" fill="#1f7a4d" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="grid h-48 place-items-center rounded-xl bg-paper text-sm text-muted">{label}</div>;
}
