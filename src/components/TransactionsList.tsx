import React, { useMemo, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  Linking
} from 'react-native';
import { useObservable } from '@legendapp/state/react';
import { blockchainStore } from '../store/blockchainStore';
import { blockTimeStore } from '../store/blockTimeStore';
import { Transaction } from '../types/blockchain';
import { formatTimestamp } from '../utils/formatters';
import { formatAddressForDisplay, normalizeTransactionHash } from '../utils/addressUtils';
import { useSdkContext } from '../context/SdkContext';
import { useForceUpdate } from '../hooks/useForceUpdate';

type TransactionsListProps = {
  testID?: string;
  onRefresh?: () => void;
};

export const TransactionsList: React.FC<TransactionsListProps> = ({
  testID,
  onRefresh
}) => {
  // Use our force update hook to ensure component updates
  const updateCounter = useForceUpdate();

  // State for refresh indicator
  const [isRefreshing, setIsRefreshing] = useState(false);

  const transactions = useObservable(blockchainStore.transactions);
  const isLoading = useObservable(blockchainStore.isLoading);
  const blockTimeMs = useObservable(blockTimeStore.blockTimeMs);
  const isCalculatingBlockTime = useObservable(blockTimeStore.isCalculating);
  const { isInitialized, isUsingMockData } = useSdkContext();
  const { width } = useWindowDimensions();

  // Handle refresh button click
  const handleRefresh = async () => {
    if (onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      await onRefresh();
      setTimeout(() => {
        setIsRefreshing(false);
      }, 800); // Ensure animation completes
    }
  };

  // Watch for loading state changes
  useEffect(() => {
    if (isLoading.get() && !isRefreshing) {
      setIsRefreshing(true);
    } else if (!isLoading.get() && isRefreshing) {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 800); // Ensure animation completes
    }
  }, [isLoading.get()]);

  // Debug logging to track component updates
  useEffect(() => {
    console.log('TransactionsList updated', {
      updateCounter,
      transactionCount: transactions.get().length,
      isLoading: isLoading.get(),
      isInitialized
    });
  }, [updateCounter, transactions.get().length, isLoading.get(), isInitialized]);

  // Check if we should use mobile layout
  const isMobile = width < 768;

  // Transform the observable data to regular array with explicit primitive values
  const transactionArray = useMemo(() => {
    console.log('TransactionsList - rebuilding transaction array with', transactions.get().length, 'items');
    const txList = transactions.get();

    if (!txList || txList.length === 0) {
      return [];
    }

    // Map to a new array of regular objects (not observables) with primitive values
    return txList.map(tx => {
      // Get primitive values from observable objects
      const hash = typeof tx.hash === 'object' ? tx.hash.get() : tx.hash || '';
      const version = typeof tx.version === 'object' ? Number(tx.version.get()) : Number(tx.version) || 0;
      const sender = typeof tx.sender === 'object' ? tx.sender.get() : tx.sender || '';
      const sequence_number = typeof tx.sequence_number === 'object' ? Number(tx.sequence_number.get()) : Number(tx.sequence_number) || 0;
      const timestamp = typeof tx.timestamp === 'object' ? tx.timestamp.get() : tx.timestamp || Date.now();
      const type = typeof tx.type === 'object' ? tx.type.get() : tx.type || 'unknown';
      const status = typeof tx.status === 'object' ? tx.status.get() : tx.status || 'pending';
      const gas_used = typeof tx.gas_used === 'object' ? Number(tx.gas_used.get()) : Number(tx.gas_used) || 0;
      const gas_unit_price = typeof tx.gas_unit_price === 'object' ? Number(tx.gas_unit_price.get()) : Number(tx.gas_unit_price) || 0;
      const vm_status = typeof tx.vm_status === 'object' ? tx.vm_status.get() : tx.vm_status || '';
      const block_height = typeof tx.block_height === 'object' ? Number(tx.block_height.get()) : Number(tx.block_height) || version - 1000;
      const epoch = typeof tx.epoch === 'object' ? tx.epoch.get() : tx.epoch || '';
      const round = typeof tx.round === 'object' ? tx.round.get() : tx.round || '';
      const state_change_hash = typeof tx.state_change_hash === 'object' ? tx.state_change_hash.get() : tx.state_change_hash || '';
      const event_root_hash = typeof tx.event_root_hash === 'object' ? tx.event_root_hash.get() : tx.event_root_hash || '';
      const accumulator_root_hash = typeof tx.accumulator_root_hash === 'object' ? tx.accumulator_root_hash.get() : tx.accumulator_root_hash || '';

      // Return a regular JavaScript object with primitive values
      return {
        hash,
        version,
        sender,
        sequence_number,
        timestamp,
        type,
        status,
        gas_used,
        gas_unit_price,
        vm_status,
        block_height,
        epoch,
        round,
        state_change_hash,
        event_root_hash,
        accumulator_root_hash
      };
    });
  }, [transactions, updateCounter]); // Also depend on updateCounter

  const handleTransactionPress = (hash: string) => {
    // Normalize the hash using our utility function
    const normalizedHash = normalizeTransactionHash(hash);

    // Validate hash before navigation
    if (!normalizedHash) {
      console.error('Invalid transaction hash:', hash);
      return;
    }

    console.log('Navigating to transaction details with normalized hash:', normalizedHash);

    // Direct navigation using URLs instead of navigation hooks
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = `/tx/${normalizedHash}`;
    } else {
      Linking.openURL(`/tx/${normalizedHash}`);
    }
  };

  // Format the transaction hash for display
  const formatHash = (hash: string) => {
    if (hash.length <= 12) return hash;
    return formatAddressForDisplay(hash, 4, 4);
  };

  // Get display text for the sender, falling back to hash if sender is not available
  const getSenderDisplay = (item: Transaction) => {
    return formatHash(item.hash);
  };

  const formatNumber = (num: number | string | undefined) => {
    if (num === undefined) return '0';
    return Number(num).toLocaleString();
  };

  // Determine function label based on transaction type
  const getFunctionLabel = (type: string) => {
    // Remove "_transaction" suffix if present
    if (type.endsWith('_transaction')) {
      return type.replace('_transaction', '');
    }

    switch (type) {
      case 'module':
        return 'module';
      case 'script':
        return 'script';
      case 'entry_function':
        return 'entry_function';
      default:
        return type;
    }
  };

  const renderTableHeader = () => {
    if (isMobile) {
      // On mobile, don't show the header - we'll include labels in the row items
      return null;
    }

    return (
      <View className="flex-row py-2.5 px-4 bg-background border-b border-border">
        <Text className="font-bold text-text-muted text-sm flex-1 min-w-[100px] font-sans">BLOCK HEIGHT</Text>
        <Text className="font-bold text-text-muted text-sm flex-1 min-w-[120px] font-sans">VERSION</Text>
        <Text className="font-bold text-text-muted text-sm flex-1 min-w-[160px] font-sans">TX HASH</Text>
        <Text className="font-bold text-text-muted text-sm flex-1 min-w-[120px] font-sans">FUNCTION</Text>
        <Text className="font-bold text-text-muted text-sm flex-1 min-w-[180px] font-sans">TIME</Text>
      </View>
    );
  };

  const renderTransactionItem = ({ item }: { item: Transaction }) => {
    // Mobile view with stacked layout
    if (isMobile) {
      return (
        <TouchableOpacity
          className="py-3 px-4 border-b border-border"
          onPress={() => handleTransactionPress(item.hash)}
          testID={`transaction-${item.hash}`}
        >
          <View className="flex-row justify-between items-center mb-2">
            <View className={`px-2 py-0.5 rounded ${item.type === 'script' ? 'bg-[#F3ECFF]' :
              item.type === 'module' ? 'bg-[#E6F7F5]' :
                item.type.includes('block_metadata') ? 'bg-[#E6F7FF]' :
                  item.type.includes('state_checkpoint') ? 'bg-[#FFECEC]' :
                    'bg-[#F5F5F5]'
              }`}>
              <Text className="text-xs text-[#333]">{getFunctionLabel(item.type)}</Text>
            </View>
            <Text className="text-white text-xs">{formatTimestamp(item.timestamp)}</Text>
          </View>

          <View className="flex-row mb-1">
            <Text className="text-text-muted text-xs mr-2">Tx Hash:</Text>
            <Text className="text-white text-xs font-data">{getSenderDisplay(item)}</Text>
          </View>

          <View className="flex-row justify-between">
            <View className="flex-row">
              <Text className="text-text-muted text-xs mr-2">Block:</Text>
              <Text className="text-white text-xs font-data">{formatNumber(item.block_height)}</Text>
            </View>
            <View className="flex-row">
              <Text className="text-text-muted text-xs mr-2">Version:</Text>
              <Text className="text-white text-xs font-data">{formatNumber(item.version)}</Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    }

    // Desktop view with row layout
    return (
      <TouchableOpacity
        className="flex-row py-3 px-4 border-b border-border"
        onPress={() => handleTransactionPress(item.hash)}
        testID={`transaction-${item.hash}`}
      >
        <Text className="text-white text-sm flex-1 min-w-[100px] font-data">{formatNumber(item.block_height)}</Text>
        <Text className="text-white text-sm flex-1 min-w-[120px] font-data">{formatNumber(item.version)}</Text>
        <Text className="text-white text-sm flex-1 min-w-[160px] font-data">{getSenderDisplay(item)}</Text>
        <View className="flex-1 min-w-[120px]">
          <View className={`px-2 py-0.5 rounded self-start ${item.type === 'script' ? 'bg-[#F3ECFF]' :
            item.type === 'module' ? 'bg-[#E6F7F5]' :
              item.type.includes('block_metadata') ? 'bg-[#E6F7FF]' :
                item.type.includes('state_checkpoint') ? 'bg-[#FFECEC]' :
                  'bg-[#F5F5F5]'
            }`}>
            <Text className="text-xs text-[#333]">{getFunctionLabel(item.type)}</Text>
          </View>
        </View>
        <Text className="text-white text-sm flex-1 min-w-[180px]">{formatTimestamp(item.timestamp)}</Text>
      </TouchableOpacity>
    );
  };

  // Initial loading state with no transactions
  if (isLoading.get() && transactionArray.length === 0) {
    return (
      <View className="mx-auto w-full max-w-screen-lg px-4 mb-5">
        <View className="bg-secondary rounded-lg" testID={testID}>
          <View className="h-1 bg-white/10" />
          <View className="flex-row justify-between items-center p-4 border-b border-border">
            <Text className="text-lg font-bold text-white">
              Recent Transactions
              <ActivityIndicator size="small" color="#E75A5C" style={{ marginLeft: 8 }} />
            </Text>
            {/* No refresh button during loading */}
          </View>

          <View className="justify-center items-center p-8">
            <ActivityIndicator size="large" color="#E75A5C" />
            <Text className="mt-4 text-base text-white">Loading transactions...</Text>
          </View>
        </View>
      </View>
    );
  }

  // Fixed condition for empty state when not loading
  if (transactionArray.length === 0 && !isLoading.get()) {
    return (
      <View className="mx-auto w-full max-w-screen-lg px-4 mb-5">
        <View className="bg-secondary rounded-lg" testID={testID}>
          <View className="h-1 bg-white/10" />
          <View className="flex-row justify-between items-center p-4 border-b border-border">
            <Text className="text-lg font-bold text-white">Recent Transactions (0)</Text>
            {isRefreshing ? (
              <ActivityIndicator size="small" color="#E75A5C" />
            ) : null}
          </View>
          <View className="justify-center items-center p-8">
            <Text className="text-white text-base mb-4">No transactions found</Text>
            <TouchableOpacity
              className="bg-primary rounded-lg py-2 px-4"
              onPress={handleRefresh}
            >
              <Text className="text-white">Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Main render for populated list
  return (
    <View className="mx-auto w-full max-w-screen-lg px-4 mb-16">
      <View className="bg-secondary rounded-lg overflow-hidden" testID={testID}>
        <View className="h-1 bg-white/10" />
        <View className="flex-row justify-between items-center p-4 border-b border-border">
          <Text className="text-lg font-bold text-white">
            Recent Transactions ({transactionArray.length})
          </Text>
          {isRefreshing ? (
            <ActivityIndicator size="small" color="#E75A5C" />
          ) : null}
        </View>

        {renderTableHeader()}

        {transactionArray.length > 0 ? (
          <View className="w-full">
            {transactionArray.map(item => (
              <View key={item.hash}>
                {renderTransactionItem({ item })}
              </View>
            ))}
          </View>
        ) : (
          <View className="justify-center items-center p-5">
            <Text className="text-white text-base">No transactions found</Text>
          </View>
        )}
      </View>
    </View>
  );
}; 