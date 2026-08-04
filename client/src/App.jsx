import {
  Routes,
  Route,
  Link,
  NavLink,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./auth.jsx";
import { Spinner } from "./components/common.jsx";
import MainMenu from "./components/MainMenu.jsx";
import Landing from "./pages/Landing.jsx";
import Home from "./pages/Home.jsx";
import CategoryServices from "./pages/CategoryServices.jsx";
import ServiceDetail from "./pages/ServiceDetail.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Orders from "./pages/Orders.jsx";
import ProviderDashboard from "./pages/ProviderDashboard.jsx";
import Notifications from "./pages/Notifications.jsx";
import Profile from "./pages/Profile.jsx";
import Settings from "./pages/Settings.jsx";
import Security from "./pages/Security.jsx";
import Payout from "./pages/Payout.jsx";
import Earnings from "./pages/Earnings.jsx";

function BackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation(); // re-render on navigation so the button appears/disappears correctly
  // Never show Back on the main home page.
  if (pathname === "/" || pathname === "/services") return null;
  // React Router tracks our position in the history stack; 0 = first page visited.
  if (!(window.history.state?.idx > 0)) return null;
  return (
    <button className="linkish back-btn" onClick={() => navigate(-1)} aria-label="Go back">
      ←
    </button>
  );
}

function Nav() {
  const { user } = useAuth();
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <BackButton />
        <Link to="/" className="brand">
          Campus<span>Connect</span>
        </Link>
        <div className="nav-links">
          {user ? (
            <MainMenu />
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <NavLink to="/register" className="pill">
                Sign up
              </NavLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function Protected({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function LandingOrRedirect() {
  const { user } = useAuth();
  // Members skip the marketing page: customers browse, providers manage.
  if (user) return <Navigate to={user.role === "provider" ? "/dashboard" : "/services"} replace />;
  return <Landing />;
}

export default function App() {
  const { loading } = useAuth();
  return (
    <>
      <Nav />
      <main className="container">
        {loading ? (
          <Spinner />
        ) : (
          <Routes>
            <Route path="/" element={<LandingOrRedirect />} />
            <Route
              path="/services"
              element={
                <Protected role="customer">
                  <Home />
                </Protected>
              }
            />
            <Route
              path="/services/category/:catId"
              element={
                <Protected role="customer">
                  <CategoryServices />
                </Protected>
              }
            />
            <Route
              path="/services/:id"
              element={
                <Protected role="customer">
                  <ServiceDetail />
                </Protected>
              }
            />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/orders"
              element={
                <Protected>
                  <Orders />
                </Protected>
              }
            />
            <Route
              path="/dashboard"
              element={
                <Protected role="provider">
                  <ProviderDashboard />
                </Protected>
              }
            />
            <Route
              path="/notifications"
              element={
                <Protected>
                  <Notifications />
                </Protected>
              }
            />
            <Route
              path="/profile"
              element={
                <Protected>
                  <Profile />
                </Protected>
              }
            />
            <Route
              path="/settings"
              element={
                <Protected>
                  <Settings />
                </Protected>
              }
            />
            <Route
              path="/settings/security"
              element={
                <Protected>
                  <Security />
                </Protected>
              }
            />
            <Route
              path="/settings/payout"
              element={
                <Protected role="provider">
                  <Payout />
                </Protected>
              }
            />
            <Route
              path="/earnings"
              element={
                <Protected role="provider">
                  <Earnings />
                </Protected>
              }
            />
            <Route path="*" element={<div className="empty">Page not found.</div>} />
          </Routes>
        )}
      </main>
      <footer className="footer">
        CampusConnect · On-demand campus services & courier marketplace for KNUST
      </footer>
    </>
  );
}
