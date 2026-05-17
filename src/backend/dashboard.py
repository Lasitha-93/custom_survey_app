import dash
from dash import dcc, html, callback, Input, Output
import dash_bootstrap_components as dbc
import plotly.graph_objects as go
import plotly.express as px
import requests
from datetime import datetime
import json

# API base URL
API_URL = 'http://localhost:5000/api/v1'

def create_dash_app(flask_app):
    """Create and configure Dash app integrated with Flask"""
    
    dash_app = dash.Dash(
        __name__,
        server=flask_app,
        url_base_pathname='/admin/dashboard/',
        external_stylesheets=[dbc.themes.BOOTSTRAP]
    )
    
    # Define app layout
    dash_app.layout = dbc.Container([
        dbc.Row([
            dbc.Col([
                html.H1("Survey Admin Dashboard", className="mt-4 mb-4")
            ], width=12)
        ]),
        
        # Statistics Cards
        dbc.Row([
            dbc.Col([
                dbc.Card([
                    dbc.CardBody([
                        html.H4("Total Sessions", className="card-title"),
                        html.H2(id="total-sessions", children="--")
                    ])
                ])
            ], md=3),
            dbc.Col([
                dbc.Card([
                    dbc.CardBody([
                        html.H4("Total Ratings", className="card-title"),
                        html.H2(id="total-ratings", children="--")
                    ])
                ])
            ], md=3),
            dbc.Col([
                dbc.Card([
                    dbc.CardBody([
                        html.H4("Completed Sessions", className="card-title"),
                        html.H2(id="completed-sessions", children="--")
                    ])
                ])
            ], md=3),
            dbc.Col([
                dbc.Card([
                    dbc.CardBody([
                        html.H4("Avg Rating/Session", className="card-title"),
                        html.H2(id="avg-per-session", children="--")
                    ])
                ])
            ], md=3),
        ], className="mb-4"),
        
        # Refresh button
        dbc.Row([
            dbc.Col([
                dbc.Button("Refresh Data", id="refresh-button", color="primary", className="mb-3"),
                html.Span(id="last-updated", className="ms-3 text-muted")
            ], width=12)
        ], className="mb-4"),
        
        # Charts
        dbc.Row([
            dbc.Col([
                dcc.Graph(id="ratings-by-sample-chart")
            ], md=6),
            dbc.Col([
                dcc.Graph(id="sessions-progress-chart")
            ], md=6),
        ], className="mb-4"),
        
        # Data Table
        dbc.Row([
            dbc.Col([
                html.H3("Recent Sessions", className="mt-4 mb-3"),
                html.Div(id="sessions-table", className="table-responsive")
            ], width=12)
        ], className="mb-4"),
        
        # Export buttons
        dbc.Row([
            dbc.Col([
                dbc.Button("Export as CSV", id="export-csv-btn", color="success", href=f"{API_URL}/admin/export/csv", className="me-2"),
                dbc.Button("Export as JSON", id="export-json-btn", color="info", href=f"{API_URL}/admin/export/json"),
            ], width=12)
        ], className="mb-4"),
        
        # Interval for auto-refresh
        dcc.Interval(id='interval-component', interval=60*1000, n_intervals=0),  # 60 seconds auto-refresh
        
    ], fluid=True, style={"backgroundColor": "#f8f9fa", "minHeight": "100vh", "padding": "20px"})
    
    # Callbacks
    @dash_app.callback(
        [Output('total-sessions', 'children'),
         Output('total-ratings', 'children'),
         Output('completed-sessions', 'children'),
         Output('avg-per-session', 'children'),
         Output('last-updated', 'children'),
         Output('ratings-by-sample-chart', 'figure'),
         Output('sessions-progress-chart', 'figure'),
         Output('sessions-table', 'children')],
        [Input('interval-component', 'n_intervals'),
         Input('refresh-button', 'n_clicks')],
    )
    def update_dashboard(n_intervals, n_clicks):
        try:
            # Fetch all dashboard data from optimized endpoint (with caching)
            dashboard_resp = requests.get(f'{API_URL}/admin/dashboard-data', timeout=5)
            dashboard_data = dashboard_resp.json() if dashboard_resp.status_code == 200 else {}
            
            if not dashboard_data.get('success'):
                # Return empty state if data fetch failed
                return "--", "--", "--", "--", "No data", go.Figure(), go.Figure(), html.Div("No data available")
            
            # Extract stats from single response
            stats = dashboard_data.get('stats', {})
            total_sessions = stats.get('total_sessions', 0)
            total_ratings = stats.get('total_ratings', 0)
            completed = stats.get('completed_sessions', 0)
            avg_per_session = stats.get('avg_per_session', 0)
            
            # Last updated time
            last_updated = f"Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            
            # Build ratings by sample chart (using pre-computed top samples)
            top_samples = dashboard_data.get('top_samples', [])
            sample_ids = [str(s['sample_id']) for s in top_samples]
            sample_counts = [s['count'] for s in top_samples]
            
            if not sample_ids:
                sample_ids = ['No data']
                sample_counts = [0]
            
            fig_ratings = px.bar(
                x=sample_ids,
                y=sample_counts,
                title="Ratings per Sample (Top 30)",
                labels={'x': 'Sample ID', 'y': 'Number of Ratings'},
                color_discrete_sequence=['#0d6efd']
            )
            
            # Build sessions progress chart
            recent_sessions = dashboard_data.get('recent_sessions', [])
            completions = [1 if s.get('is_completed') else 0 for s in recent_sessions]
            session_ids = [s.get('id', f'Session')[:8] for s in recent_sessions]
            
            if not session_ids:
                session_ids = ['No data']
                completions = [0]
            
            fig_sessions = px.bar(
                x=session_ids,
                y=completions,
                title="Session Completion Status (Recent 10)",
                labels={'x': 'Session ID', 'y': 'Completed (1 = Yes, 0 = No)'},
                color_discrete_sequence=['#28a745']
            )
            
            # Build sessions table
            table_rows = []
            for session in recent_sessions[:10]:
                table_rows.append(
                    html.Tr([
                        html.Td(session.get('id', 'N/A')[:12]),
                        html.Td(session.get('created_at', 'N/A')[:16]),
                        html.Td(session.get('last_sample_index', 0)),
                        html.Td(session.get('last_stage', 0)),
                        html.Td("✓ Yes" if session.get('is_completed') else "✗ No", style={"color": "green" if session.get('is_completed') else "red"})
                    ])
                )
            
            if not table_rows:
                table_rows = [html.Tr([html.Td("No sessions yet", colSpan=5)])]
            
            sessions_table = html.Table([
                html.Thead(
                    html.Tr([
                        html.Th("Session ID"),
                        html.Th("Created At"),
                        html.Th("Last Sample"),
                        html.Th("Last Stage"),
                        html.Th("Completed")
                    ])
                ),
                html.Tbody(table_rows)
            ], className="table table-striped table-hover")
            
            return (
                f"{total_sessions}",
                f"{total_ratings}",
                f"{completed}",
                f"{avg_per_session:.1f}",
                last_updated,
                fig_ratings,
                fig_sessions,
                sessions_table
            )
            
        except Exception as e:
            print(f"Error updating dashboard: {e}")
            import traceback
            traceback.print_exc()
            error_fig = go.Figure().add_annotation(text=f"Error: {str(e)}", showarrow=False)
            return ("--", "--", "--", "--", f"Error: {str(e)}", error_fig, error_fig, html.Div(f"Error: {str(e)}"))
    
    return dash_app
