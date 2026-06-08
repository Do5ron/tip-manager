import { useState, useMemo, useEffect, useCallback } from "react";

const GAS_URL = "https://script.google.com/macros/s/AKfycbzVT_SIdh1gAC3-dZq7WkynvtCoN5z6SrhR2jZ4_b7ZbY4UHnDIDR9so0DIpHboo80/exec";
const TABS = ["Staff", "Shift", "Monthly", "Payment"];

function formatILS(n) { return "₪" + Number(n).toFixed(2); }
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDateStr(date) {
  if (!date) return "";
  // Date object — use local parts directly
  if (date instanceof Date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  }
  const s = String(date).trim();
  // Already clean YYYY-MM-DD with no time
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO string with time e.g. "2026-05-31T21:00:00.000Z" — parse as Date and use LOCAL parts
  if (s.includes("T") || s.includes("Z")) {
    const d = new Date(s);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  // MM/DD/YYYY
  if (s.includes("/")) {
    const [m, d, y] = s.split("/");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  return s.slice(0, 10);
}
function getMonthKey(d) { return d.slice(0, 7); }

async function gasGet(action) {
  const res = await fetch(`${GAS_URL}?action=${action}`);
  return res.json();
}
async function gasPost(body) {
  const res = await fetch(GAS_URL, { method: "POST", body: JSON.stringify(body) });
  return res.json();
}

// staff shape: { name, active }
function initStaff() { return { waitresses: [], bartenders: [] }; }

export default function App() {
  const [tab, setTab] = useState("Shift");
  const [staff, setStaff] = useState(initStaff());
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [newWaitress, setNewWaitress] = useState("");
  const [newBartender, setNewBartender] = useState("");

  // Shift state
  const [shiftDate, setShiftDate] = useState(getTodayStr());
  const [selectedWaitresses, setSelectedWaitresses] = useState([]);
  const [selectedBartenders, setSelectedBartenders] = useState([]);
  const [waitressHours, setWaitressHours] = useState({});
  const [bartenderHours, setBartenderHours] = useState({});
  const [waitressTips, setWaitressTips] = useState("");
  const [bartenderTips, setBartenderTips] = useState("");
  const [shiftResult, setShiftResult] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [wDropOpen, setWDropOpen] = useState(false);
  const [bDropOpen, setBDropOpen] = useState(false);

  // Monthly
  const [monthFilter, setMonthFilter] = useState(getTodayStr().slice(0, 7));

  // Payment
  const [paymentName, setPaymentName] = useState("");
  const [paymentFrom, setPaymentFrom] = useState("");
  const [paymentTo, setPaymentTo] = useState(getTodayStr());

  const showSync = (msg, ms = 3000) => { setSyncMsg(msg); setTimeout(() => setSyncMsg(""), ms); };

  const loadData = useCallback(async () => {
    setLoading(true);
    setSyncMsg("Loading from Google Sheets...");
    try {
      const [staffData, shiftData] = await Promise.all([gasGet("getStaff"), gasGet("getShifts")]);
      const waitresses = [], bartenders = [];
      if (Array.isArray(staffData)) {
        staffData.forEach((row, i) => {
          if (i === 0 && row[0] === "role") return;
          const active = row[2] !== "inactive";
          if (row[0] === "waitress") waitresses.push({ name: row[1], active });
          if (row[0] === "bartender") bartenders.push({ name: row[1], active });
        });
      }
      if (waitresses.length > 0 || bartenders.length > 0) setStaff({ waitresses, bartenders });

      if (Array.isArray(shiftData) && shiftData.length > 1) {
        const shiftMap = {};
        shiftData.slice(1).forEach(row => {
          let [rawDate, type, name, hours, tips, pension, tipPerHourBefore, tipPerHourAfter, totalPool, transferToBartenders] = row;
          const date = parseDateStr(rawDate);
          if (!shiftMap[date]) shiftMap[date] = { date, waitressResults: [], bartenderResults: [], pension: 0, waitressTips: 0, bartenderTips: 0, transferToBartenders: 0, waitressPool: 0, bartenderPool: 0 };
          if (type === "waitress") {
            shiftMap[date].waitressResults.push({ name, hrs: Number(hours), tips: Number(tips), pension: Number(pension), tipPerHourBefore: Number(tipPerHourBefore), tipPerHourAfter: Number(tipPerHourAfter) });
            shiftMap[date].transferToBartenders = Number(transferToBartenders);
            shiftMap[date].waitressTips = Number(totalPool);
          }
          if (type === "bartender") {
            shiftMap[date].bartenderResults.push({ name, hrs: Number(hours), tips: Number(tips), tipPerHour: Number(tipPerHourAfter) });
            shiftMap[date].bartenderTips = Number(totalPool);
          }
        });
        Object.values(shiftMap).forEach(s => {
          s.pension = s.waitressResults.reduce((a, w) => a + w.pension, 0);
          s.waitressPool = s.waitressResults.reduce((a, w) => a + w.tips, 0);
          s.bartenderPool = s.bartenderResults.reduce((a, b) => a + b.tips, 0);
        });
        setShifts(Object.values(shiftMap));
      }
      showSync("✅ Synced");
    } catch (e) {
      showSync("⚠️ Could not connect to Google Sheets");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveStaffToSheets(newStaffObj) {
    const rows = [
      ...newStaffObj.waitresses.map(s => ["waitress", s.name, s.active ? "active" : "inactive"]),
      ...newStaffObj.bartenders.map(s => ["bartender", s.name, s.active ? "active" : "inactive"]),
    ];
    await gasPost({ action: "saveStaff", rows });
  }

  async function addStaff(role) {
    const name = role === "waitress" ? newWaitress.trim() : newBartender.trim();
    if (!name) return;
    const key = role === "waitress" ? "waitresses" : "bartenders";
    const newStaff = { ...staff, [key]: [...staff[key], { name, active: true }] };
    setStaff(newStaff);
    role === "waitress" ? setNewWaitress("") : setNewBartender("");
    setSaving(true);
    await saveStaffToSheets(newStaff);
    setSaving(false);
    showSync("✅ Staff saved");
  }

  async function removeStaff(role, name) {
    const key = role === "waitress" ? "waitresses" : "bartenders";
    const newStaff = { ...staff, [key]: staff[key].filter(s => s.name !== name) };
    setStaff(newStaff);
    await saveStaffToSheets(newStaff);
    showSync("✅ Removed");
  }

  async function toggleActive(role, name) {
    const key = role === "waitress" ? "waitresses" : "bartenders";
    const newStaff = {
      ...staff,
      [key]: staff[key].map(s => s.name === name ? { ...s, active: !s.active } : s)
    };
    setStaff(newStaff);
    await saveStaffToSheets(newStaff);
  }

  const activeWaitresses = staff.waitresses.filter(s => s.active).map(s => s.name);
  const activeBartenders = staff.bartenders.filter(s => s.active).map(s => s.name);

  function handleDateChange(newDate) {
    setShiftDate(newDate);
    setShiftLoading(true);
    setShiftResult(null);
    setSelectedWaitresses([]);
    setSelectedBartenders([]);
    setWaitressHours({});
    setBartenderHours({});
    setWaitressTips("");
    setBartenderTips("");

    // Small delay so state clears visually before loading
    setTimeout(() => {
      setShifts(prev => {
        const existing = prev.find(s => s.date === newDate);
        if (existing) {
          const wNames = existing.waitressResults.map(w => w.name);
          const bNames = existing.bartenderResults.map(b => b.name);
          setSelectedWaitresses(wNames);
          setSelectedBartenders(bNames);
          const wHrs = {};
          existing.waitressResults.forEach(w => { wHrs[w.name] = String(w.hrs); });
          setWaitressHours(wHrs);
          const bHrs = {};
          existing.bartenderResults.forEach(b => { bHrs[b.name] = String(b.hrs); });
          setBartenderHours(bHrs);
          setWaitressTips(String(existing.waitressTips));
          setBartenderTips(String(existing.bartenderTips));
          setShiftResult(existing);
        }
        setShiftLoading(false);
        return prev;
      });
    }, 300);
  }

  function toggleSelect(name, list, setList) {
    setList(l => l.includes(name) ? l.filter(n => n !== name) : [...l, name]);
  }

  async function calculateShift() {
    const wTips = parseFloat(waitressTips) || 0;
    const bTips = parseFloat(bartenderTips) || 0;
    const transferToBartenders = wTips * 0.05;
    const afterTransfer = wTips - transferToBartenders;
    const pension = afterTransfer * 0.15;
    const waitressPool = afterTransfer * 0.85;
    const bartenderPool = bTips + transferToBartenders;
    const afterPension = afterTransfer; // for per-hour-before calc
    const totalWHours = selectedWaitresses.reduce((s, n) => s + (parseFloat(waitressHours[n]) || 0), 0);
    const totalBHours = selectedBartenders.reduce((s, n) => s + (parseFloat(bartenderHours[n]) || 0), 0);

    const waitressResults = selectedWaitresses.map(name => {
      const hrs = parseFloat(waitressHours[name]) || 0;
      const share = totalWHours > 0 ? (hrs / totalWHours) * waitressPool : 0;
      const shareBeforePension = totalWHours > 0 ? (hrs / totalWHours) * afterTransfer : 0;
      const myPension = totalWHours > 0 ? (hrs / totalWHours) * pension : 0;
      return { name, hrs, tips: share, pension: myPension, tipPerHourAfter: hrs > 0 ? share / hrs : 0, tipPerHourBefore: hrs > 0 ? shareBeforePension / hrs : 0 };
    });

    const bartenderResults = selectedBartenders.map(name => {
      const hrs = parseFloat(bartenderHours[name]) || 0;
      const share = totalBHours > 0 ? (hrs / totalBHours) * bartenderPool : 0;
      return { name, hrs, tips: share, tipPerHour: hrs > 0 ? share / hrs : 0 };
    });

    const result = { date: shiftDate, waitressResults, bartenderResults, pension, waitressTips: wTips, bartenderTips: bTips, transferToBartenders, waitressPool, bartenderPool };
    setShiftResult(result);
    setShifts(prev => [...prev.filter(s => s.date !== shiftDate), result]);

    setSaving(true);
    showSync("Saving...");
    try {
      await gasPost({ action: "deleteShift", date: shiftDate });
      const rows = [
        ...waitressResults.map(w => [shiftDate, "waitress", w.name, w.hrs, w.tips, w.pension, w.tipPerHourBefore, w.tipPerHourAfter, wTips, transferToBartenders]),
        ...bartenderResults.map(b => [shiftDate, "bartender", b.name, b.hrs, b.tips, 0, 0, b.tipPerHour, bTips, 0]),
      ];
      await gasPost({ action: "saveShift", rows });
      showSync("✅ Shift saved");
    } catch (e) {
      showSync("⚠️ Saved locally only");
    }
    setSaving(false);
  }

  function copyShiftSummary() {
    if (!shiftResult) return;
    let text = `Shift Summary — ${shiftResult.date}\n\n👩 Waitresses:\n`;
    shiftResult.waitressResults.forEach(w => { text += `- ${w.name}: ${formatILS(w.tips)} (${w.hrs} hrs) | /hr before pension: ${formatILS(w.tipPerHourBefore)} | after: ${formatILS(w.tipPerHourAfter)}\n`; });
    text += `\n🍹 Bartenders:\n`;
    shiftResult.bartenderResults.forEach(b => { text += `- ${b.name}: ${formatILS(b.tips)} (${b.hrs} hrs) | /hr: ${formatILS(b.tipPerHour)}\n`; });
    text += `\n💰 Pension collected: ${formatILS(shiftResult.pension)}`;
    navigator.clipboard.writeText(text).then(() => alert("Copied!"));
  }

  const monthlyData = useMemo(() => {
    const filtered = shifts.filter(s => getMonthKey(s.date) === monthFilter);
    const wMap = {}, bMap = {};
    filtered.forEach(shift => {
      shift.waitressResults.forEach(w => {
        if (!wMap[w.name]) wMap[w.name] = { days: 0, hours: 0, pension: 0, tips: 0, tipPerHourBeforeSum: 0, tipPerHourAfterSum: 0 };
        wMap[w.name].days++; wMap[w.name].hours += w.hrs; wMap[w.name].pension += w.pension;
        wMap[w.name].tips += w.tips; wMap[w.name].tipPerHourBeforeSum += w.tipPerHourBefore; wMap[w.name].tipPerHourAfterSum += w.tipPerHourAfter;
      });
      shift.bartenderResults.forEach(b => {
        if (!bMap[b.name]) bMap[b.name] = { days: 0, hours: 0, tips: 0, tipPerHourSum: 0 };
        bMap[b.name].days++; bMap[b.name].hours += b.hrs; bMap[b.name].tips += b.tips; bMap[b.name].tipPerHourSum += b.tipPerHour;
      });
    });
    return { waitresses: wMap, bartenders: bMap };
  }, [shifts, monthFilter]);

  const paymentData = useMemo(() => {
    if (!paymentName) return null;
    const isWaitress = staff.waitresses.some(s => s.name === paymentName);
    const rows = shifts
      .filter(s => (!paymentFrom || s.date >= paymentFrom) && s.date <= paymentTo)
      .map(shift => {
        const w = shift.waitressResults?.find(x => x.name === paymentName);
        const b = shift.bartenderResults?.find(x => x.name === paymentName);
        const p = w || b;
        if (!p) return null;
        return { date: shift.date, hrs: p.hrs, tipPerHourBefore: isWaitress ? p.tipPerHourBefore : null, tipPerHourAfter: isWaitress ? p.tipPerHourAfter : p.tipPerHour, total: p.tips };
      })
      .filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
    return { rows, grandTotal: rows.reduce((s, r) => s + r.total, 0), isWaitress };
  }, [paymentName, paymentFrom, paymentTo, shifts, staff]);

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "system-ui", color: "#6c63ff" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🍽️</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Loading Tip Manager...</div>
      <div style={{ fontSize: 13, color: "#aaa", marginTop: 8 }}>Connecting to Google Sheets</div>
    </div>
  );

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 600, margin: "0 auto", padding: 16, background: "#f8f9fa", minHeight: "100vh" }}>
      <h1 style={{ textAlign: "center", color: "#1a1a2e", fontSize: 22, marginBottom: 2 }}>🍽️ Tip Manager</h1>
      <div style={{ textAlign: "center", fontSize: 11, color: "#bbb", marginBottom: 12, letterSpacing: 1 }}>v1.9</div>

      {syncMsg && (
        <div style={{ textAlign: "center", fontSize: 12, color: syncMsg.includes("⚠️") ? "#e74c3c" : "#27ae60", marginBottom: 8, padding: "6px 12px", background: "#fff", borderRadius: 8 }}>
          {syncMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "#fff", borderRadius: 12, padding: 4, boxShadow: "0 1px 4px #0001" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "10px 0", border: "none", borderRadius: 10, cursor: "pointer",
            background: tab === t ? "#6c63ff" : "transparent",
            color: tab === t ? "#fff" : "#666", fontWeight: tab === t ? 700 : 400, fontSize: 13,
          }}>{t}</button>
        ))}
      </div>

      {/* ===== STAFF TAB ===== */}
      {tab === "Staff" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[{ role: "waitress", key: "waitresses", label: "👩 Waitresses", color: "#6c63ff", bg: "#f0eeff", newVal: newWaitress, setNew: setNewWaitress },
            { role: "bartender", key: "bartenders", label: "🍹 Bartenders", color: "#ff6584", bg: "#fff0f3", newVal: newBartender, setNew: setNewBartender }
          ].map(({ role, key, label, color, bg, newVal, setNew }) => (
            <Card key={role} title={label}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input value={newVal} onChange={e => setNew(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addStaff(role)}
                  placeholder={`Add ${role} name...`} style={inputStyle} />
                <Btn onClick={() => addStaff(role)} primary disabled={saving}>Add</Btn>
              </div>
              {staff[key].length === 0 && <div style={{ color: "#aaa", fontSize: 13 }}>No {role}s added yet</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {staff[key].map(({ name, active }) => (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, background: active ? bg : "#f2f2f2", borderRadius: 8, padding: "10px 14px", opacity: active ? 1 : 0.6 }}>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: active ? "#1a1a2e" : "#999" }}>{name}</span>
                    {/* Active toggle */}
                    <div onClick={() => toggleActive(role, name)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <div style={{
                        width: 38, height: 20, borderRadius: 10, position: "relative",
                        background: active ? color : "#ccc", transition: "background 0.2s",
                      }}>
                        <div style={{
                          position: "absolute", top: 2, left: active ? 20 : 2,
                          width: 16, height: 16, borderRadius: "50%", background: "#fff",
                          transition: "left 0.2s", boxShadow: "0 1px 3px #0003"
                        }} />
                      </div>
                      <span style={{ fontSize: 11, color: active ? color : "#aaa", fontWeight: 600, width: 44 }}>{active ? "Active" : "Inactive"}</span>
                    </div>
                    <button onClick={() => removeStaff(role, name)} style={{ background: "none", border: "none", cursor: "pointer", color: "#e74c3c", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ===== SHIFT TAB ===== */}
      {tab === "Shift" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="📅 Shift Setup">
            <label style={labelStyle}>Date</label>
            <input type="date" value={shiftDate} onChange={e => handleDateChange(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />

            {shiftLoading && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "#6c63ff", fontSize: 13, fontWeight: 600 }}>
                ⏳ Loading shift data...
              </div>
            )}

            {!shiftLoading && (
            <div>
            <ShiftDropdown
              label="👩 Waitresses"
              color="#6c63ff"
              activeBg="#f0eeff"
              open={wDropOpen}
              onToggle={() => setWDropOpen(o => !o)}
              activeStaff={activeWaitresses}
              selected={selectedWaitresses}
              hours={waitressHours}
              onSelect={name => toggleSelect(name, selectedWaitresses, setSelectedWaitresses)}
              onHoursChange={(name, val) => setWaitressHours(h => ({ ...h, [name]: val }))}
            />

            {/* Bartenders dropdown */}
            <ShiftDropdown
              label="🍹 Bartenders"
              color="#ff6584"
              activeBg="#fff0f3"
              open={bDropOpen}
              onToggle={() => setBDropOpen(o => !o)}
              activeStaff={activeBartenders}
              selected={selectedBartenders}
              hours={bartenderHours}
              onSelect={name => toggleSelect(name, selectedBartenders, setSelectedBartenders)}
              onHoursChange={(name, val) => setBartenderHours(h => ({ ...h, [name]: val }))}
            />

            <div style={{ display: "flex", gap: 8, marginBottom: 8, marginTop: 4 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Waitress tips (₪)</label>
                <input type="number" value={waitressTips} onChange={e => setWaitressTips(e.target.value)} style={inputStyle} placeholder="0" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Bartender tips (₪)</label>
                <input type="number" value={bartenderTips} onChange={e => setBartenderTips(e.target.value)} style={inputStyle} placeholder="0" />
              </div>
            </div>

            <Btn onClick={calculateShift} full primary disabled={saving}>
              {saving ? "Saving..." : "Calculate & Save Shift"}
            </Btn>
            </div>
            )}
          </Card>

          {shiftResult && (
            <Card title={`📊 Results — ${shiftResult.date}`}>
              <div style={{ background: "#f0eeff", borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 }}>
                <div>Total waitress tips: {formatILS(shiftResult.waitressTips)}</div>
                <div>Pension (15%): <strong style={{ color: "#e74c3c" }}>{formatILS(shiftResult.pension)}</strong></div>
                <div>Transfer to bartenders (5%): {formatILS(shiftResult.transferToBartenders)}</div>
                <div>Waitress pool: {formatILS(shiftResult.waitressPool)} &nbsp;|&nbsp; Bartender pool: {formatILS(shiftResult.bartenderPool)}</div>
              </div>

              <div style={{ fontWeight: 700, marginBottom: 6, color: "#6c63ff" }}>👩 Waitresses</div>
              {shiftResult.waitressResults.map(w => (
                <div key={w.name} style={{ background: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{w.name} — {w.hrs} hrs</div>
                  <div>Tips: <strong>{formatILS(w.tips)}</strong></div>
                  <div style={{ color: "#888" }}>Per hour before pension: {formatILS(w.tipPerHourBefore)} &nbsp;|&nbsp; After: {formatILS(w.tipPerHourAfter)}</div>
                </div>
              ))}

              <div style={{ fontWeight: 700, marginBottom: 6, color: "#ff6584", marginTop: 8 }}>🍹 Bartenders</div>
              {shiftResult.bartenderResults.map(b => (
                <div key={b.name} style={{ background: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{b.name} — {b.hrs} hrs</div>
                  <div>Tips: <strong>{formatILS(b.tips)}</strong></div>
                  <div style={{ color: "#888" }}>Per hour: {formatILS(b.tipPerHour)}</div>
                </div>
              ))}

              <Btn onClick={copyShiftSummary} full>📋 Copy Shift Summary</Btn>
            </Card>
          )}
        </div>
      )}

      {/* ===== MONTHLY TAB ===== */}
      {tab === "Monthly" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="📆 Monthly Summary">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Month</label>
                <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={inputStyle} />
              </div>
              <Btn onClick={loadData}>🔄</Btn>
            </div>

            <div style={{ fontWeight: 700, color: "#6c63ff", marginBottom: 8 }}>👩 Waitresses</div>
            {Object.keys(monthlyData.waitresses).length === 0 && <div style={{ color: "#aaa", fontSize: 13, marginBottom: 12 }}>No data for this month</div>}
            {Object.entries(monthlyData.waitresses).map(([name, d]) => (
              <div key={name} style={{ background: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  <span style={{ color: "#888" }}>Work days:</span><span>{d.days}</span>
                  <span style={{ color: "#888" }}>Total hours:</span><span>{d.hours}</span>
                  <span style={{ color: "#888" }}>Avg/hr before pension:</span><span>{formatILS(d.days > 0 ? d.tipPerHourBeforeSum / d.days : 0)}</span>
                  <span style={{ color: "#888" }}>Avg/hr after pension:</span><span>{formatILS(d.days > 0 ? d.tipPerHourAfterSum / d.days : 0)}</span>
                  <span style={{ color: "#888" }}>Total pension:</span><span style={{ color: "#e74c3c" }}>{formatILS(d.pension)}</span>
                  <span style={{ color: "#888" }}>Total tips after pension:</span><span style={{ fontWeight: 700 }}>{formatILS(d.tips)}</span>
                </div>
              </div>
            ))}

            <div style={{ fontWeight: 700, color: "#ff6584", marginBottom: 8, marginTop: 12 }}>🍹 Bartenders</div>
            {Object.keys(monthlyData.bartenders).length === 0 && <div style={{ color: "#aaa", fontSize: 13, marginBottom: 12 }}>No data for this month</div>}
            {Object.entries(monthlyData.bartenders).map(([name, d]) => (
              <div key={name} style={{ background: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  <span style={{ color: "#888" }}>Work days:</span><span>{d.days}</span>
                  <span style={{ color: "#888" }}>Total hours:</span><span>{d.hours}</span>
                  <span style={{ color: "#888" }}>Avg/hr:</span><span>{formatILS(d.days > 0 ? d.tipPerHourSum / d.days : 0)}</span>
                  <span style={{ color: "#888" }}>Total tips:</span><span style={{ fontWeight: 700 }}>{formatILS(d.tips)}</span>
                </div>
              </div>
            ))}

            <Btn onClick={() => {
              let text = `Monthly Summary — ${monthFilter}\n\nWaitresses:\nName | Days | Hours | Avg/hr Before | Avg/hr After | Pension | Total\n`;
              Object.entries(monthlyData.waitresses).forEach(([name, d]) => {
                text += `${name} | ${d.days} | ${d.hours} | ${formatILS(d.days > 0 ? d.tipPerHourBeforeSum / d.days : 0)} | ${formatILS(d.days > 0 ? d.tipPerHourAfterSum / d.days : 0)} | ${formatILS(d.pension)} | ${formatILS(d.tips)}\n`;
              });
              text += `\nBartenders:\nName | Days | Hours | Avg/hr | Total\n`;
              Object.entries(monthlyData.bartenders).forEach(([name, d]) => {
                text += `${name} | ${d.days} | ${d.hours} | ${formatILS(d.days > 0 ? d.tipPerHourSum / d.days : 0)} | ${formatILS(d.tips)}\n`;
              });
              navigator.clipboard.writeText(text).then(() => alert("Copied!"));
            }} full>📋 Copy Monthly Summary</Btn>
          </Card>
        </div>
      )}

      {/* ===== PAYMENT TAB ===== */}
      {tab === "Payment" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="💸 Payment Lookup">
            <label style={labelStyle}>Select staff member</label>
            <select value={paymentName} onChange={e => setPaymentName(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
              <option value="">-- Select --</option>
              <optgroup label="Waitresses">{staff.waitresses.map(s => <option key={s.name} value={s.name}>{s.name}{!s.active ? " (inactive)" : ""}</option>)}</optgroup>
              <optgroup label="Bartenders">{staff.bartenders.map(s => <option key={s.name} value={s.name}>{s.name}{!s.active ? " (inactive)" : ""}</option>)}</optgroup>
            </select>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>From</label>
                <input type="date" value={paymentFrom} onChange={e => setPaymentFrom(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>To</label>
                <input type="date" value={paymentTo} onChange={e => setPaymentTo(e.target.value)} style={inputStyle} />
              </div>
            </div>

            {paymentData && paymentData.rows.length === 0 && (
              <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: 20 }}>No shifts found for this period</div>
            )}

            {paymentData && paymentData.rows.length > 0 && (
              <>
                {paymentData.rows.map(r => (
                  <div key={r.date} style={{ background: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>📅 {r.date}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                      <span style={{ color: "#888" }}>Hours:</span><span>{r.hrs}</span>
                      {paymentData.isWaitress && <><span style={{ color: "#888" }}>Tip/hr before pension:</span><span>{formatILS(r.tipPerHourBefore)}</span></>}
                      <span style={{ color: "#888" }}>Tip/hr after pension:</span><span>{formatILS(r.tipPerHourAfter)}</span>
                      <span style={{ color: "#888" }}>Total:</span><span style={{ fontWeight: 700 }}>{formatILS(r.total)}</span>
                    </div>
                  </div>
                ))}
                <div style={{ background: "#6c63ff", color: "#fff", borderRadius: 10, padding: "12px 16px", textAlign: "center", fontWeight: 700, fontSize: 16, marginTop: 4 }}>
                  Total to pay {paymentName}: {formatILS(paymentData.grandTotal)}
                </div>
                <Btn full onClick={() => {
                  let text = `Payment for ${paymentName}\n${paymentFrom || "all"} → ${paymentTo}\n\n`;
                  paymentData.rows.forEach(r => { text += `${r.date}: ${r.hrs} hrs | After pension: ${formatILS(r.tipPerHourAfter)}/hr | Total: ${formatILS(r.total)}\n`; });
                  text += `\nTotal to pay: ${formatILS(paymentData.grandTotal)}`;
                  navigator.clipboard.writeText(text).then(() => alert("Copied!"));
                }}>📋 Copy Payment Summary</Btn>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function ShiftDropdown({ label, color, activeBg, open, onToggle, activeStaff, selected, hours, onSelect, onHoursChange }) {
  const selectedCount = selected.length;
  const missingHours = selected.filter(n => !hours[n] || hours[n] === "").length;

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Dropdown trigger */}
      <div onClick={onToggle} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: open ? activeBg : "#f8f8f8",
        border: `2px solid ${open ? color : "#e0e0e0"}`,
        borderRadius: open ? "8px 8px 0 0" : 8,
        padding: "10px 14px", cursor: "pointer", transition: "all 0.15s",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: open ? color : "#444" }}>{label}</span>
          {selectedCount > 0 && (
            <span style={{ background: color, color: "#fff", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
              {selectedCount} selected
            </span>
          )}
          {missingHours > 0 && (
            <span style={{ background: "#ffeaa7", color: "#d35400", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
              {missingHours} missing hrs
            </span>
          )}
        </div>
        <span style={{ color: "#aaa", fontSize: 16, transition: "transform 0.2s", display: "inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </div>

      {/* Dropdown content */}
      {open && (
        <div style={{ border: `2px solid ${color}`, borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
          {activeStaff.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 13, color: "#aaa" }}>No active staff. Set them as active in the Staff tab.</div>
          )}
          {activeStaff.map((name, i) => {
            const isSelected = selected.includes(name);
            return (
              <div key={name} style={{
                display: "flex", alignItems: "center", gap: 10,
                background: isSelected ? activeBg : "#fff",
                padding: "10px 14px",
                borderTop: i > 0 ? "1px solid #f0f0f0" : "none",
              }}>
                {/* Checkbox */}
                <div onClick={() => onSelect(name)} style={{
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0, cursor: "pointer",
                  border: `2px solid ${isSelected ? color : "#ccc"}`,
                  background: isSelected ? color : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isSelected && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </div>

                {/* Name */}
                <span onClick={() => onSelect(name)} style={{ flex: 1, fontWeight: isSelected ? 600 : 400, fontSize: 14, cursor: "pointer" }}>{name}</span>

                {/* Hours input — always visible when selected */}
                {isSelected && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="number" min="0" step="0.5" placeholder="hrs"
                      value={hours[name] || ""}
                      onChange={e => onHoursChange(name, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      style={{ width: 58, padding: "4px 8px", borderRadius: 6, border: `1.5px solid ${hours[name] ? color : "#ffb347"}`, fontSize: 13, outline: "none", textAlign: "center" }}
                    />
                    <span style={{ fontSize: 12, color: "#888" }}>hrs</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 6px #0001" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: "#1a1a2e" }}>{title}</div>
      {children}
    </div>
  );
}

function Btn({ onClick, children, full, primary, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: full ? "100%" : "auto", padding: "10px 16px", border: "none", borderRadius: 8,
      cursor: disabled ? "not-allowed" : "pointer",
      background: primary ? "#6c63ff" : "#f0eeff",
      color: primary ? "#fff" : "#6c63ff",
      fontWeight: 600, fontSize: 14, marginTop: full ? 8 : 0, opacity: disabled ? 0.6 : 1,
    }}>{children}</button>
  );
}

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e0e0e0", fontSize: 13, boxSizing: "border-box", outline: "none" };
const labelStyle = { fontSize: 12, color: "#888", display: "block", marginBottom: 4 };
