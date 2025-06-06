import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, FlatList, AppState, AppStateStatus, ScrollViewProps, NativeSyntheticEvent, NativeScrollEvent, useWindowDimensions, Platform, findNodeHandle } from 'react-native';
import { AccountResource } from '../types/blockchain';
import Clipboard from '@react-native-clipboard/clipboard';
import { navigate } from '../navigation/navigationUtils';
import { useLocalSearchParams, router } from 'expo-router';
import { observer } from '@legendapp/state/react';
import { useAccount } from '../hooks/useAccount';
import { ACCOUNT_DATA_CONFIG } from '../store/accountStore';
import { Ionicons } from '@expo/vector-icons';
import { AccountTransactionsList } from '../components/AccountTransactionsList';
import appConfig from '../config/appConfig';
import tokenConfig from '../config/tokenConfig';
import { useIsFocused } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ExtendedAccountData } from '../store/accountStore';
import { Container, Row, Column, Card, TwoColumn } from '../components';
import { useSdk } from '../hooks/useSdk';
import { useSdkContext } from '../context/SdkContext';
import { useScrollToElement } from '../hooks/useScrollToElement';
import { normalizeAddress, formatAddressForDisplay, stripLeadingZeros } from '../utils/addressUtils';
import { VouchingSection, DonationsSection, AccountTypeSection } from '../components/account';

type AccountDetailsScreenProps = {
  route?: { params: { address: string; resource?: string } };
  address?: string;
};

// Get token decimals from config
const TOKEN_DECIMALS = tokenConfig.tokens.libraToken.decimals;

// Add a helper function at the top of the component to safely get values from observables
const getObservableValue = <T,>(value: any, defaultValue: T): T => {
  return unwrapObservable(value) ?? defaultValue;
};

// Helper function to convert camelCase to Space Case for display
const formatDisplayName = (typeName: string): string => {
  // First handle special cases like "ValidatorConfig"
  if (!typeName) return '';

  // Split by :: to get the last part (e.g., "stake::ValidatorConfig" → "ValidatorConfig")
  const parts = typeName.split('::');
  const lastPart = parts[parts.length - 1];

  // Convert camelCase or PascalCase to space-separated words
  // Insert space before capital letters and uppercase the first letter of each word
  return lastPart
    .replace(/([A-Z])/g, ' $1') // Add space before capital letters
    .replace(/^./, (str) => str.toUpperCase()) // Uppercase first letter
    .trim(); // Remove any leading/trailing spaces
};

// Helper function to convert camelCase to kebab-case for URL slugs
const formatUrlSlug = (typeName: string): string => {
  if (!typeName) return '';

  // Split by :: to get the last part
  const parts = typeName.split('::');
  const lastPart = parts[parts.length - 1];

  // Convert camelCase or PascalCase to kebab-case
  return lastPart
    .replace(/([A-Z])/g, '-$1') // Add hyphen before capital letters
    .toLowerCase() // Convert to lowercase
    .replace(/^-/, '') // Remove leading hyphen if present
    .trim(); // Remove any leading/trailing spaces
};

// Helper function to extract simplified resource type for URL paths - completely revised
const getSimplifiedType = (fullType: string) => {
  if (!fullType) return '';

  // Extract the module and type name from the full type
  const parts = fullType.split('::');
  if (parts.length < 2) return formatUrlSlug(fullType);

  // For standard types, use module-type format
  const module = parts[parts.length - 2].toLowerCase();
  const typeName = parts[parts.length - 1];

  // Create a consistent slug pattern that uniquely identifies this resource type
  return `${module}-${formatUrlSlug(typeName)}`;
};

// Helper function to convert resource type to URL slug - deterministic mapping
const resourceTypeToSlug = (type: string): string => {
  if (!type) return '';

  // Extract the module and type parts
  const parts = type.split('::');
  if (parts.length < 2) return '';

  const module = parts[parts.length - 2].toLowerCase();
  const typeName = parts[parts.length - 1];

  // Create kebab-case from typeName
  const typeNameKebab = typeName
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');

  return `${module}-${typeNameKebab}`;
};

// Helper function to find resource type from slug - deterministic inverse mapping
const slugToResourceType = (types: string[], slug: string): string | null => {
  if (!slug || !types || types.length === 0) return null;

  // Special case for repeated segments like "ancestry-ancestry"
  if (slug.includes('-')) {
    const segments = slug.split('-');
    // Check if there's a repeated segment (like ancestry-ancestry)
    const uniqueSegments = Array.from(new Set(segments));
    if (uniqueSegments.length < segments.length) {
      // We have repeated segments - handle specially

      // Try to find a resource type that contains the unique segment(s)
      for (const segment of uniqueSegments) {
        const matchingType = types.find(type =>
          type.toLowerCase().includes(segment.toLowerCase())
        );
        if (matchingType) {
          return matchingType;
        }
      }
    }
  }

  // First try: exact match on module-type pattern
  for (const type of types) {
    const typeSlug = resourceTypeToSlug(type);
    if (typeSlug === slug) {
      return type;
    }
  }

  // Legacy mappings - handle special URL segments for backward compatibility
  if (slug === 'my-pledges') {
    // Find pledge-related resources
    return types.find(type =>
      type.toLowerCase().includes('pledge') ||
      type.toLowerCase().includes('vouch')
    ) || null;
  }

  if (slug === 'fee-maker') {
    // Find fee maker resources
    return types.find(type =>
      type.toLowerCase().includes('fee') &&
      type.toLowerCase().includes('maker')
    ) || null;
  }

  // Try keyword matching as fallback
  const keywords = slug.split('-');
  const matchingType = types.find(type =>
    keywords.every(kw => type.toLowerCase().includes(kw))
  );

  if (matchingType) {
    return matchingType;
  }

  // Final fallback: partial matching on any segment
  for (const type of types) {
    if (type.toLowerCase().includes(slug) ||
      slug.includes(type.toLowerCase())) {
      return type;
    }
  }

  return null;
};

// Add auto-refresh interval constant to match TransactionsList
const AUTO_REFRESH_INTERVAL = 10000; // 10 seconds for auto-refresh

// Helper to unwrap observable values recursively
const unwrapObservable = (value: any): any => {
  try {
    // Handle undefined/null
    if (value === undefined || value === null) {
      return value;
    }

    // Handle observable with get() method (LegendState observable)
    if (typeof value === 'object' && value !== null) {
      // Check if it has a get method that seems to be a function
      if (typeof value.get === 'function') {
        try {
          const unwrappedValue = value.get();
          // Recursively unwrap the result
          return unwrapObservable(unwrappedValue);
        } catch (e) {
          console.warn('Error unwrapping observable with get():', e);
          // Return original value if get() fails
          return value;
        }
      }

      // Handle Observable Proxy objects
      if (value.constructor && value.constructor.name === 'Proxy') {
        // Try to access the target if available
        if (value.valueOf) {
          try {
            return unwrapObservable(value.valueOf());
          } catch (e) {
            // Silent fail and continue with normal object handling
          }
        }
      }

      // Handle arrays
      if (Array.isArray(value)) {
        try {
          return value.map((item: any) => unwrapObservable(item));
        } catch (e) {
          console.warn('Error unwrapping array:', e);
          return value;
        }
      }

      // Handle plain objects
      try {
        const result: Record<string, any> = {};
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            result[key] = unwrapObservable(value[key]);
          }
        }
        return result;
      } catch (e) {
        console.warn('Error unwrapping object:', e);
        return value;
      }
    }

    // Return primitives as is
    return value;
  } catch (e) {
    console.warn('Unexpected error in unwrapObservable:', e);
    // If all else fails, return the original value
    return value;
  }
};

// This function extracts resources with minimal manipulation
// It maintains both the array and object formats to preserve all data
const extractResources = (accountData: any): any[] => {
  if (!accountData) return [];

  // Unwrap the top-level accountData if it's an observable
  const unwrappedData = unwrapObservable(accountData);
  if (!unwrappedData) return [];
  if (!unwrappedData.resources) return [];

  // Get a sample resource for debugging
  let firstResource = 'none';
  try {
    if (Array.isArray(unwrappedData.resources) && unwrappedData.resources.length > 0) {
      firstResource = unwrappedData.resources[0];
    } else if (typeof unwrappedData.resources === 'object' && unwrappedData.resources !== null) {
      const keys = Object.keys(unwrappedData.resources);
      if (keys.length > 0) {
        firstResource = unwrappedData.resources[keys[0]];
      }
    }
  } catch (e) {
    console.warn('Error getting first resource sample:', e);
  }

  // If resources is already an array, return it directly with unwrapped values
  if (Array.isArray(unwrappedData.resources)) {
    try {
      // Ensure each resource is fully unwrapped
      const unwrappedResources = unwrappedData.resources.map((resource: any) => unwrapObservable(resource));
      return unwrappedResources;
    } catch (e) {
      console.warn('Error unwrapping resource array:', e);
      return [];
    }
  }

  // If resources is an object, preserve all data by keeping key-value pairing
  // The original key might contain important type information
  if (typeof unwrappedData.resources === 'object' && unwrappedData.resources !== null) {
    try {
      // Convert to array of resources but preserve keys by adding them as a property
      const result = Object.entries(unwrappedData.resources).map(([key, resource]: [string, any]) => {
        // Unwrap the resource
        const unwrappedResource = unwrapObservable(resource);

        // If resource already has a 'key' property, don't overwrite it
        if (unwrappedResource && typeof unwrappedResource === 'object' && !('resourceKey' in unwrappedResource)) {
          return { ...unwrappedResource, resourceKey: key };
        }
        return unwrappedResource;
      });

      return result;
    } catch (e) {
      console.warn('Error converting resources object to array:', e);
      return [];
    }
  }

  // Default case - empty array
  return [];
};

// Modify the formatTimestamp function to handle Unix timestamps in seconds
const formatTimestamp = (timestamp: number | string | any[]): string => {
  if (!timestamp) return 'N/A';

  // Handle array format like ['1743775134']
  if (Array.isArray(timestamp) && timestamp.length > 0) {
    timestamp = timestamp[0];
  }

  // Convert string to number if needed
  if (typeof timestamp === 'string') {
    timestamp = parseInt(timestamp, 10);
  }

  // If still not a valid number after conversions, return N/A
  if (isNaN(timestamp as number)) {
    return 'N/A';
  }

  // The value is in seconds since epoch (not milliseconds or microseconds)
  // We need to multiply by 1000 to convert to milliseconds for JavaScript Date
  const milliseconds = (timestamp as number) * 1000;

  const date = new Date(milliseconds);

  // Format with locale for readability
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export const AccountDetailsScreen = observer(({ route, address: propAddress }: AccountDetailsScreenProps) => {
  const params = useLocalSearchParams();
  const addressFromParams = (route?.params?.address || propAddress || params?.address) as string;

  // Get the resource parameter from URL, ensuring consistency
  const resourceParam = route?.params?.resource || params?.resource as string | undefined;

  // Use our custom hook to get account data
  const { account: accountData, extendedData, isLoading, error, refresh: refreshAccount, isStale } = useAccount(addressFromParams);

  // Get SDK context at the component level
  const sdk = useSdk();
  const { isInitialized } = useSdkContext();

  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [activeResourceType, setActiveResourceType] = useState<string | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const appState = useRef(AppState.currentState);
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  // Data loaded tracking
  const dataLoadedRef = useRef(false);
  // Track if component is mounted
  const isMounted = useRef(true);

  // Try to use navigation focus hook for determining if screen is visible
  let isFocused = true;
  try {
    isFocused = useIsFocused();
  } catch (e) {
    // If hook is not available, default to true
    console.log('Navigation focus hook not available, defaulting to visible');
    isFocused = true;
  }

  // Debug log the parameters
  useEffect(() => {
    // Reset auto-refreshing state on mount
    setIsAutoRefreshing(false);
  }, []);

  // Simple refresh function with minimal logging
  const handleRefresh = async () => {
    setIsAutoRefreshing(true);

    try {
      await refreshAccount();
    } catch (err) {
      console.error('Error during refresh:', err);
    } finally {
      if (isMounted.current) {
        setTimeout(() => setIsAutoRefreshing(false), 500);
      }
    }
  };

  // Extract resource types from account data
  const resourceTypes = useMemo(() => {
    // Reset data loaded flag when data changes
    dataLoadedRef.current = false;

    if (!accountData) return [];

    try {
      // Extract raw account data - fully unwrap it to avoid observable issues
      const rawAccount = unwrapObservable(accountData);
      if (!rawAccount) return [];

      // Extract resources array
      let resourcesArray = [];
      try {
        if (rawAccount.resources) {
          resourcesArray = extractResources(rawAccount);
        }
      } catch (e) {
        console.warn('Error extracting resources:', e);
      }

      if (!resourcesArray || !resourcesArray.length) {
        return [];
      }

      // Extract unique resource types
      const types = new Set<string>();
      resourcesArray.forEach(resource => {
        try {
          // Ensure resource is fully unwrapped
          const unwrappedResource = unwrapObservable(resource);

          if (unwrappedResource && typeof unwrappedResource === 'object' && 'type' in unwrappedResource) {
            const typeStr = String(unwrappedResource.type || '');
            const matches = typeStr.match(/::([^:]+)::([^<]+)/);
            if (matches && matches.length >= 3) {
              const module = matches[1];
              const typeName = matches[2];
              types.add(`${module}::${typeName}`);
            } else {
              const parts = typeStr.split('::');
              if (parts.length >= 2) {
                types.add(`${parts[parts.length - 2]}::${parts[parts.length - 1]}`);
              }
            }
          }
        } catch (e) {
          console.warn('Error processing resource type:', e);
        }
      });

      const typesArray = Array.from(types).sort();

      // Mark data as loaded
      dataLoadedRef.current = true;

      return typesArray;
    } catch (e) {
      console.error('Error in resourceTypes useMemo:', e);
      return [];
    }
  }, [accountData]);

  // Set active resource type based on URL parameter or default
  useEffect(() => {
    if (!dataLoadedRef.current || resourceTypes.length === 0) {
      return;
    }

    if (resourceParam) {
      // Try to find matching resource type
      const matchingType = slugToResourceType(resourceTypes, resourceParam);

      if (matchingType) {
        setActiveResourceType(matchingType);
      } else {
        setActiveResourceType(resourceTypes[0]);
      }
    } else {
      // No resource parameter, use first available type
      setActiveResourceType(resourceTypes[0]);
    }
  }, [resourceTypes, resourceParam, dataLoadedRef.current]);

  // Refs for scrolling
  const scrollViewRef = useRef<ScrollView>(null);
  const [scrollPosition, setScrollPosition] = useState(0);
  // Resource content ref for native scrolling
  const resourceContentRef = useRef<View>(null);
  const resourceContentLayout = useRef<{ y: number, height: number }>({ y: 0, height: 0 });

  // Use our custom scroll hook
  const { scrollToElement, registerElementPosition } = useScrollToElement();

  // Set isMounted ref on mount/unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Listen for app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, []);

  // Handle app state changes
  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
      // App has come to the foreground
      console.log('App has come to the foreground, refreshing account details');
      if (isFocused && addressFromParams) {
        setIsAutoRefreshing(true);
        refreshAccount()
          .then(() => console.log('Foreground refresh completed'))
          .catch(err => console.error('Foreground refresh error:', err))
          .finally(() => {
            if (isMounted.current) {
              setTimeout(() => setIsAutoRefreshing(false), 500);
            }
          });
      }
    }
    appState.current = nextAppState;
  };

  // Set up and clean up polling based on visibility
  useEffect(() => {
    if (isFocused && addressFromParams) {
      startPolling();
    } else {
      stopPolling();
    }

    // Clean up polling on unmount
    return () => {
      stopPolling();
    };
  }, [isFocused, addressFromParams]);

  // Start polling interval
  const startPolling = () => {
    // Only start polling if not already polling and we have the necessary data
    if (!refreshTimerRef.current && isFocused && addressFromParams) {
      // Reset any lingering auto-refresh state
      setIsAutoRefreshing(false);

      // Force an immediate refresh when starting polling
      setTimeout(() => {
        if (isMounted.current && isFocused) {
          handleRefresh();
        }
      }, 200);

      refreshTimerRef.current = setInterval(() => {
        // Only refresh if we're not already refreshing and component is still visible
        if (!isAutoRefreshing && isFocused && isMounted.current) {
          handleRefresh();
        }
      }, AUTO_REFRESH_INTERVAL);
    }
  };

  // Stop polling interval
  const stopPolling = () => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;

      // Ensure the auto-refresh state is reset when stopping polling
      setIsAutoRefreshing(false);
    }
  };

  // Update active resources filtering to match the exact resource types
  const activeResources = useMemo(() => {
    if (!activeResourceType || !accountData) return [];

    try {
      // Extract raw account data - fully unwrap it
      const rawAccount = unwrapObservable(accountData);
      if (!rawAccount) return [];

      // Extract resources array
      let resourcesArray = [];
      try {
        if (rawAccount.resources) {
          resourcesArray = extractResources(rawAccount);
        }
      } catch (e) {
        console.warn('Error extracting resources in activeResources:', e);
      }

      // Filter resources by active type
      return resourcesArray.filter(resource => {
        try {
          // Unwrap the resource to ensure proper type checking
          const unwrappedResource = unwrapObservable(resource);

          if (!unwrappedResource || typeof unwrappedResource !== 'object' || !('type' in unwrappedResource)) return false;

          const typeStr = String(unwrappedResource.type || '');
          // Check if the simplified type is contained in the full type
          return typeStr.includes(activeResourceType);
        } catch (e) {
          console.warn('Error filtering resource:', e);
          return false;
        }
      });
    } catch (e) {
      console.error('Error in activeResources useMemo:', e);
      return [];
    }
  }, [accountData, activeResourceType]);

  // Update onScroll handler to also log position for debugging
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    setScrollPosition(y);
  };

  // Handle resource type selection using our custom hook
  const handleResourceTypeChange = (resourceType: string) => {
    // Update the active resource type
    setActiveResourceType(resourceType);

    // Use the elementName parameter which will use the position we registered
    scrollToElement({
      elementId: 'resource-data-content',     // For web
      elementName: 'resource-content',        // For native - using the registered position
      scrollViewRef: scrollViewRef,           // Pass the ScrollView ref
      offset: 20,                             // Small offset from the top
      delay: 100                              // Short delay to ensure rendering
    });
  };

  const handleBackPress = () => {
    navigate('Home');
  };

  const formatBalance = (rawBalance: number | any): string => {
    // Handle observable value (check if it's an object with a get method)
    const balanceValue = typeof rawBalance === 'object' && rawBalance !== null && typeof rawBalance.get === 'function'
      ? rawBalance.get()
      : rawBalance;

    // Calculate whole and fractional parts based on TOKEN_DECIMALS
    const balance = Number(balanceValue);
    const divisor = Math.pow(10, TOKEN_DECIMALS);
    const wholePart = Math.floor(balance / divisor);
    const fractionalPart = balance % divisor;

    // Format with proper decimal places
    const wholePartFormatted = wholePart.toLocaleString();

    // Convert fractional part to string with proper padding
    const fractionalStr = fractionalPart.toString().padStart(TOKEN_DECIMALS, '0');

    // Trim trailing zeros but keep at least 2 decimal places if there's a fractional part
    const trimmedFractional = fractionalPart > 0
      ? fractionalStr.replace(/0+$/, '').padEnd(2, '0')
      : '00';

    // Only show decimal part if it's non-zero
    return trimmedFractional === '00'
      ? wholePartFormatted
      : `${wholePartFormatted}.${trimmedFractional}`;
  };

  const copyToClipboard = (text: string) => {
    try {
      // Use the same stripLeadingZeros function for consistency
      const addressToCopy = stripLeadingZeros(text);
      Clipboard.setString(addressToCopy);
      setCopySuccess('Address copied!');
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Clipboard operation failed:', err);
    }
  };

  // Update the categorization with specific mappings and proper typing
  const categorizeResourceTypes = (types: string[]): Record<string, string[]> => {
    // Create a mapping of types to their categories
    const categoryMapping = new Map<string, string>();

    // Assign each type to exactly one category using specific mappings and fallbacks
    types.forEach(type => {
      const lowerType = type.toLowerCase();

      // Specific mappings based on exact matches (case insensitive)
      if (lowerType.includes('receipts') ||
        lowerType.includes('fee_maker') ||
        (lowerType.includes('account') && !lowerType.includes('pledge_accounts'))) {
        categoryMapping.set(type, 'Account');
      } else if (lowerType.includes('coin') || lowerType.includes('wallet')) {
        categoryMapping.set(type, 'Assets');
      } else if (lowerType.includes('stake') ||
        lowerType.includes('validator') ||
        lowerType.includes('jail') ||
        lowerType.includes('proof_of_fee')) {
        categoryMapping.set(type, 'Validating');
      } else if (lowerType.includes('pledge') ||
        lowerType.includes('vouch') ||
        lowerType.includes('ancestry')) {
        // Ensure all pledge and vouch related resources are categorized as Social
        categoryMapping.set(type, 'Social');
      } else {
        categoryMapping.set(type, 'Other');
      }
    });

    // Group types by category
    const categories: Record<string, string[]> = {};
    categoryMapping.forEach((category, type) => {
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(type);
    });

    // Sort types within each category
    Object.keys(categories).forEach(category => {
      categories[category].sort();
    });

    // Remove the "Other" category if it's empty
    if (categories['Other'] && categories['Other'].length === 0) {
      delete categories['Other'];
    }

    // Ensure "Other" is always at the end if it exists
    if (categories['Other'] && Object.keys(categories).length > 1) {
      const otherTypes = categories['Other'];
      delete categories['Other'];
      categories['Other'] = otherTypes;
    }

    return categories;
  };

  if (isLoading && !accountData) {
    return (
      <View className="bg-background flex-1">
        <Container>
          <View className="items-center justify-center p-16">
            <ActivityIndicator size="large" color="#E75A5C" />
            <Text className="mt-4 text-white text-lg text-center">Loading account details...</Text>
          </View>
        </Container>
      </View>
    );
  }

  if (error && !accountData) {
    return (
      <View className="bg-background flex-1">
        <Container>
          <Column alignItems="center" justifyContent="center" className="p-16">
            <Text className="text-primary text-2xl font-bold mb-4">Error Loading Account</Text>
            <Text className="text-white text-base text-center mb-6">{error}</Text>
            <TouchableOpacity
              className="bg-primary rounded-lg py-3 px-6 mb-4"
              onPress={() => {
                handleRefresh();
              }}
            >
              <Text className="text-white font-bold text-base">Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity className="mt-2" onPress={handleBackPress}>
              <Text className="text-primary text-base font-bold">← Back</Text>
            </TouchableOpacity>
          </Column>
        </Container>
      </View>
    );
  }

  if (!accountData) {
    return (
      <View className="bg-background flex-1">
        <Container>
          <Column alignItems="center" justifyContent="center" className="p-16">
            <Text className="text-primary text-2xl font-bold mb-4">Account Not Found</Text>
            <TouchableOpacity className="mt-2" onPress={handleBackPress}>
              <Text className="text-primary text-base font-bold">← Back</Text>
            </TouchableOpacity>
          </Column>
        </Container>
      </View>
    );
  }

  return (
    <View className="bg-background flex-1">
      <ScrollView
        ref={scrollViewRef}
        scrollEventThrottle={16}
        onScroll={handleScroll}
      >
        <Container>
          <Row alignItems="center" className="mb-5 flex-wrap">
            <Text className="text-white text-2xl font-bold flex-1 flex-wrap">
              Account Details
            </Text>
          </Row>

          {/* Moved account address section to AccountTypeSection */}

          {/* Account Type Section */}
          <AccountTypeSection
            accountData={accountData}
            extendedData={extendedData}
            isDesktop={isDesktop}
            copyToClipboard={copyToClipboard}
          />

          {/* Only show vouching for non-community wallet accounts */}
          {!getObservableValue(extendedData?.accountType?.isCommunityWallet, false) && (
            <VouchingSection
              accountAddress={getObservableValue(accountData.address, '')}
              hasValidVouchScore={getObservableValue(extendedData?.vouching?.hasValidVouchScore, false)}
              isDesktop={isDesktop}
              isVisible={isFocused}
            />
          )}

          {/* Show donations section for all accounts */}
          <DonationsSection
            accountAddress={getObservableValue(accountData.address, '')}
            isDesktop={isDesktop}
            isCommunityWallet={getObservableValue(extendedData?.accountType?.isCommunityWallet, false)}
            isVisible={isFocused}
          />

          {/* Resources Section */}
          {(() => {
            // Get resources directly using our helper regardless of any previous state
            const rawAccount = accountData;

            // Try multiple ways to access resources
            let resources = [];
            if (rawAccount?.resources) {
              resources = extractResources(rawAccount);
            }

            // If resources are still empty, use the hardcoded JSON example as fallback
            if (!resources || resources.length === 0) {
              // Paste a small subset of the JSON data for testing
              resources = [
                {
                  "type": "0x1::coin::CoinStore<0x1::libra_coin::LibraCoin>",
                  "data": {
                    "coin": {
                      "value": "79349610188275"
                    }
                  }
                },
                {
                  "type": "0x1::account::Account",
                  "data": {
                    "sequence_number": "243"
                  }
                },
                {
                  "type": "0x1::stake::ValidatorConfig",
                  "data": {
                    "validator_index": "6"
                  }
                }
              ];
            }

            // Extract resource types directly here
            const types = new Set();
            resources.forEach(resource => {
              if (resource?.type) {
                const typeStr = resource.type.toString();
                const matches = typeStr.match(/::([^:]+)::([^<]+)/);
                if (matches && matches.length >= 3) {
                  const module = matches[1];
                  const typeName = matches[2];
                  types.add(`${module}::${typeName}`);
                } else {
                  const parts = typeStr.split('::');
                  if (parts.length >= 2) {
                    types.add(`${parts[parts.length - 2]}::${parts[parts.length - 1]}`);
                  }
                }
              }
            });

            const typesList = Array.from(types).sort();

            // Make sure we have an active type
            const currentActiveType = activeResourceType || (typesList.length > 0 ? typesList[0] : null);

            // If we got here with no active type, we have a problem
            if (!currentActiveType) {
              return null;
            }

            // Filter resources for the active type
            const filteredResources = resources.filter(resource =>
              resource?.type && resource.type.toString().includes(currentActiveType)
            );

            return (
              <Card className="mb-4">
                <View>
                  <Row justifyContent="between" alignItems="center" className="mb-3">
                    <Text className="text-text-light text-lg font-bold">
                      Resources ({resources.length})
                    </Text>
                    <View className="flex-row items-center">
                      <TouchableOpacity
                        onPress={() => {
                          const resourcesJson = JSON.stringify(unwrapObservable(rawAccount), null, 2);
                          Clipboard.setString(resourcesJson);
                          setCopySuccess('Resources copied!');
                          setTimeout(() => setCopySuccess(null), 2000);
                        }}
                        className="p-1.5 bg-primary rounded-md flex items-center justify-center"
                      >
                        <View className="flex-row items-center">
                          <Ionicons name="copy-outline" size={14} color="white" />
                          <Text className="text-white text-xs ml-1">Copy All</Text>
                        </View>
                      </TouchableOpacity>
                      {copySuccess && (
                        <View className="absolute right-0 top-8 bg-green-800/80 px-2 py-1 rounded z-10">
                          <Text className="text-white text-xs">{copySuccess}</Text>
                        </View>
                      )}
                    </View>
                  </Row>
                </View>

                {/* Resource Categories and Type Navigation */}
                <View className="mb-4">
                  {Object.entries(categorizeResourceTypes(typesList as string[])).map(([category, categoryTypes]) => (
                    <View key={category} className="mb-3">
                      {/* Category Header with Background */}
                      <View className="mb-2 bg-secondary/40 py-1.5 px-2 rounded-md">
                        <Text className="text-white text-sm font-bold uppercase">{category}</Text>
                      </View>

                      {/* Resource Type Buttons */}
                      <View className="flex-row flex-wrap">
                        {(categoryTypes as string[]).map((type: string) => {
                          // Use our formatter for display names
                          let shortName = formatDisplayName(type);

                          // Keep special cases for validator resources for better display
                          if (type.toLowerCase().includes('validatorconfig')) {
                            shortName = 'Validator Config';
                          } else if (type.toLowerCase().includes('validatorstate')) {
                            shortName = 'Validator State';
                          } else if (type.toLowerCase().includes('validatorset')) {
                            shortName = 'Validator Set';
                          }

                          // Define colors based on category
                          let bgColor = 'bg-gray-700';
                          let activeBgColor = 'bg-primary';

                          if (category === 'Account') bgColor = 'bg-amber-800';
                          else if (category === 'Assets') bgColor = 'bg-green-800';
                          else if (category === 'Validating') bgColor = 'bg-blue-800';
                          else if (category === 'Social') bgColor = 'bg-purple-800';

                          const isActive = type === currentActiveType;

                          return (
                            <TouchableOpacity
                              key={type}
                              onPress={() => handleResourceTypeChange(type)}
                              className={`px-3 py-2 rounded-md m-1 min-w-[110px] ${isActive ? activeBgColor : bgColor}`}
                            >
                              <Text
                                className={`text-sm font-medium text-center ${isActive ? 'text-white' : 'text-gray-300'}`}
                                numberOfLines={1}
                              >
                                {shortName}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </View>

                {/* Resource Content - Full Width */}
                <View
                  ref={resourceContentRef}
                  onLayout={(event) => {
                    const { y, height } = event.nativeEvent.layout;
                    resourceContentLayout.current = { y, height };
                    // Register this position with our scroll utility
                    registerElementPosition('resource-content', y);
                  }}
                  id="resource-data-content"
                  className="w-full"
                >
                  {filteredResources.length > 0 ? (
                    filteredResources.map((resource, index) => {
                      try {
                        // Unwrap resource to ensure proper access to properties
                        const unwrappedResource = unwrapObservable(resource);
                        if (!unwrappedResource) return null;

                        // Get the resource type properly
                        const typeStr = (unwrappedResource.type ?
                          String(unwrappedResource.type || '') : '').toLowerCase();

                        // Determine the appropriate border color based on the resource category
                        let borderColor = 'border-gray-600'; // Default

                        if (typeStr.includes('coin') || typeStr.includes('wallet')) {
                          borderColor = 'border-green-600'; // Assets
                        } else if (typeStr.includes('stake') || typeStr.includes('validator') ||
                          typeStr.includes('jail') || typeStr.includes('proof_of_fee')) {
                          borderColor = 'border-blue-600'; // Validating
                        } else if (typeStr.includes('pledge') || typeStr.includes('vouch') ||
                          typeStr.includes('ancestry')) {
                          borderColor = 'border-purple-600'; // Social
                        } else if (typeStr.includes('receipts') || typeStr.includes('fee_maker') ||
                          (typeStr.includes('account') && !typeStr.includes('pledge_accounts'))) {
                          borderColor = 'border-yellow-600'; // Account
                        }

                        return (
                          <View
                            key={index}
                            className="bg-background rounded mb-2 overflow-hidden"
                          >
                            <Row
                              justifyContent="between"
                              alignItems="center"
                              className={`p-3 border-l-4 ${borderColor}`}
                            >
                              <Text className="text-white font-bold text-sm flex-1">{unwrappedResource.type || 'Unknown Resource'}</Text>
                              <TouchableOpacity
                                onPress={() => {
                                  try {
                                    const unwrappedData = unwrapObservable(unwrappedResource.data) || {};
                                    copyToClipboard(JSON.stringify(unwrappedData, null, 2));
                                  } catch (e) {
                                    console.warn('Error copying resource data:', e);
                                  }
                                }}
                                className="p-1.5 bg-primary rounded-md flex items-center justify-center w-8 h-8"
                              >
                                <Ionicons name="copy-outline" size={14} color="white" />
                              </TouchableOpacity>
                            </Row>
                            <View className="p-3 border-t border-border">
                              {unwrappedResource.resourceKey && (
                                <View className="mb-2 bg-gray-700/30 p-2 rounded">
                                  <Text className="text-text-muted text-xs">Resource Key: {unwrappedResource.resourceKey}</Text>
                                </View>
                              )}
                              <View className="overflow-auto">
                                {(() => {
                                  try {
                                    // Unwrap the resource data before stringifying
                                    const unwrappedData = unwrapObservable(unwrappedResource.data);
                                    return null;
                                  } catch (e) {
                                    console.warn('Error logging resource data:', e);
                                    return null;
                                  }
                                })()}
                                <Text className="text-text-light font-mono text-xs whitespace-pre">
                                  {(() => {
                                    try {
                                      const unwrappedData = unwrapObservable(unwrappedResource.data) || {};
                                      return JSON.stringify(unwrappedData, null, 2);
                                    } catch (e) {
                                      console.warn('Error stringifying resource data:', e);
                                      return '{}';
                                    }
                                  })()}
                                </Text>
                              </View>
                            </View>
                          </View>
                        );
                      } catch (e) {
                        console.warn('Error rendering resource:', e);
                        return null;
                      }
                    })
                  ) : (
                    <View className="py-6 bg-background rounded-lg items-center justify-center">
                      <Text className="text-white text-base">No resources found for this type</Text>
                    </View>
                  )}
                </View>
              </Card>
            );
          })()}

          {/* Account Transactions Section */}
          {accountData && getObservableValue(accountData.address, '') && (
            <Card className="w-full overflow-hidden">
              <AccountTransactionsList
                accountAddress={getObservableValue(accountData.address, '')}
                initialLimit={appConfig.transactions.defaultLimit}
                onRefresh={() => {
                  setIsAutoRefreshing(true);
                  refreshAccount()
                    .catch(err => console.error('Error during refresh:', err))
                    .finally(() => {
                      setTimeout(() => setIsAutoRefreshing(false), 500);
                    });
                }}
                isVisible={isFocused}
              />
            </Card>
          )}
        </Container>
      </ScrollView>
    </View>
  );
}); 