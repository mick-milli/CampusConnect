import { Routes, Route, Link, NavLink, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import { Spinner } from "./components/common.jsx";
import Home from "./pages/Home.jsx";
import ServiceDetail from "./pages/ServiceDetail.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Orders from "./pages/Orders.jsx";
import ProviderDashboard from "./pages/ProviderDashboard.jsx";

function Nav() {
  const { user, logout } = useAuth();
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Link to="/" className="brand">
          Campus<span>Connect</span>
        </Link>
        <div className="nav-links">
          <NavLink to="/" end>
            Browse
          </NavLink>
          {user && <NavLink to="/orders">My Orders</NavLink>}
          {user?.role === "provider" && <NavLink to="/dashboard">Dashboard</NavLink>}
          {user ? (
            <>
              <span className="pill">{user.name.split(" ")[0]}</span>
              <button className="linkish" onClick={logout}>
                Log out
              </button>
            </>
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
            <Route path="/" element={<Home />} />
            <Route path="/services/:id" element={<ServiceDetail />} />
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
