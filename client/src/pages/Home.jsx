import { useAuth } from "../auth.jsx";
import ProviderBrowser from "../components/ProviderBrowser.jsx";

// Customer dashboard: providers are the only thing showcased (Alibaba-style).
// The service tabs under "Providers on campus" filter the grid; customers pick
// a service, then choose the provider they prefer.
export default function Home() {
  const { user } = useAuth();
  return (
    <>
      <section className="hero compact">
        <span className="badge">🎓 KNUST campus marketplace</span>
        <h1>Welcome back{user ? `, ${user.name.split(" ")[0]}` : ""}.</h1>
        <p>Browse campus providers — pick a service tab, then choose the provider you prefer.</p>
      </section>

      <ProviderBrowser title="Providers on campus" showSearch />
    </>
  );
}
