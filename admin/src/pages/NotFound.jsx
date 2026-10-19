import { Link } from 'react-router';

export default function NotFound({ message = 'This page does not exist.' }) {
    return (
        <div className="card mx-auto max-w-md text-center">
            <p className="text-slate-600">{message}</p>
            <Link to="/" className="btn-ghost mt-3">Back to dashboard</Link>
        </div>
    );
}
