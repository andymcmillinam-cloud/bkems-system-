import { Routes, Route, Navigate } from "react-router";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import StoreDetail from "./pages/StoreDetail";
import StoreAdvanced from "./pages/StoreAdvanced";
import TempsDetail from "./pages/store/TempsDetail";
import LightsDetail from "./pages/store/LightsDetail";
import HvacDetail from "./pages/store/HvacDetail";
import Alerts from "./pages/Alerts";
import Admin from "./pages/Admin";
import Operator from "./pages/Operator";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="/stores/:id" element={<StoreDetail />} />
      <Route path="/stores/:id/advanced" element={<StoreAdvanced />} />
      <Route path="/stores/:id/temps" element={<TempsDetail />} />
      <Route path="/stores/:id/lights" element={<LightsDetail />} />
      <Route path="/stores/:id/hvac" element={<HvacDetail />} />
      <Route path="/alerts" element={<Alerts />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/operator" element={<Operator />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
