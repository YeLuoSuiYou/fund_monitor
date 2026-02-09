import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import FundDetail from "./pages/FundDetail";
import BacktestReport from "./pages/BacktestReport";
import { useApplyTheme } from "./hooks/useApplyTheme";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  useApplyTheme();

  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/backtest" element={<BacktestReport />} />
          <Route path="/fund/:code" element={<FundDetail />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}
