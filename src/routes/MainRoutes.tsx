import MainLayout from 'layout/MainLayout';
import ErrorBoundary from './ErrorBoundary';
import { Navigate } from 'react-router';
import EarnPage from 'views/home/EarnPage';
import BorrowPage from 'views/home/BorrowPage';
import VaultDetailsPage from 'views/home/VaultDetailsPage';
import MarketDetailPage from 'views/home/MarketDetailPage';
import DashboardPage from 'views/home/DashboardPage';
import ExplorePage from 'views/home/ExplorePage';
import LendPage from 'views/home/LendPage';
import LendVaultDetailsPage from 'views/home/LendVaultDetailsPage';
import BorrowDetailPage from 'views/home/BorrowDetailPage';
import PortfolioPage from 'views/home/PortfolioPage';
import PositionManagePage from 'views/home/PositionManagePage';

// ==============================|| MAIN ROUTING ||============================== //

const MainRoutes = {
  path: '/',
  element: <MainLayout />,
  // Inherited by every child route: a render error shows the app's own error card, not React
  // Router's default stack-trace screen.
  errorElement: <ErrorBoundary />,
  children: [
    {
      index: true,
      element: <Navigate to="explore" replace />
    },
    {
      path: '/explore',
      element: <ExplorePage />
    },
    {
      path: '/dashboard',
      element: <DashboardPage />
    },
    {
      path: '/earn',
      element: <EarnPage />
    },
    {
      path: '/earn/vault/:vaultAddress',
      element: <VaultDetailsPage />
    },
    {
      path: '/lend',
      element: <LendPage />
    },
    {
      path: '/lend/:lendAddress',
      element: <LendVaultDetailsPage />
    },
    {
      path: '/borrow',
      element: <BorrowPage />
    },
    {
      path: '/borrow/:collateral/:liability',
      element: <BorrowDetailPage />
    },
    {
      path: '/borrow/market/:marketId',
      element: <MarketDetailPage />
    },
    {
      path: '/portfolio',
      element: <PortfolioPage />
    },
    {
      path: '/portfolio/position/:collateral/:liability',
      element: <PositionManagePage />
    }
  ]
};

export default MainRoutes;
