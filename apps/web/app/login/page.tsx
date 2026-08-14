import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="etroit">
      <h1>Prometis</h1>
      <p className="lede">Gestion de promotions immobilières — Suisse romande.</p>

      <section>
        <h2>Connexion</h2>
        <LoginForm />
      </section>

      <section>
        <h2>Comptes de démonstration</h2>
        <p className="note">
          Mot de passe commun : <code>Prometis!2026</code>
        </p>
        <table>
          <tbody>
            <tr>
              <td>
                <code>christophe@probat.ch</code>
              </td>
              <td>Propriétaire chez Probat</td>
            </tr>
            <tr>
              <td>
                <code>julie@probat.ch</code>
              </td>
              <td>Cheffe de projet, accès à une opération</td>
            </tr>
            <tr>
              <td>
                <code>m.girard@constructa.ch</code>
              </td>
              <td>Deux sociétés : propriétaire chez Constructa, externe chez Probat</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
